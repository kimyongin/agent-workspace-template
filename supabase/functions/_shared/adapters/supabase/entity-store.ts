import { entityId } from "../../contracts/entity-identity.ts";
import { insertWithIdRetry } from "./data-id.ts";
import type postgres from "postgres";
import type {
  EntityCreate,
  EntityDetail,
  EntityQuery,
  EntitySummary,
  EntityUpdate,
  EntityValues,
} from "../../contracts/entity.ts";
import { entityPresentation, loadEntityDefinition } from "./entity-values.ts";
import type { EntityStore } from "../../core/entity/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
import { hasTag, setTagLinks, tagIdsColumn } from "./tag-links.ts";
const columns =
  "id,source,external_id,deleted_at,entity_type_id,schema_version,properties,version,created_at,updated_at";
function result(r: Record<string, unknown>) {
  return {
    tag_ids: (r.tag_ids as string[]) ?? [],
    id: r.id as string,
    source: r.source as string,
    external_id: r.external_id as string,
    source_label: r.source as string,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : null,
    entity_type_id: r.entity_type_id as string,
    schema_version: Number(r.schema_version),
    properties: r.properties as EntityValues["properties"],
    version: r.version as number,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}
export class SqlEntityStore extends SqlActorStore implements EntityStore {
  async definition(typeId: string, lock = false) {
    return loadEntityDefinition(this.tx, typeId, lock);
  }
  async get(id: string, lock = false) {
    if (lock) {
      // Discover immutable type without locking the entity; acquire type first for publication/migration.
      const [identity] = await this.tx`select entity_type_id from app.entities where id=${id}`;
      if (!identity) return null;
      await this.definition(identity.entity_type_id, true);
      const rows = await this.tx`select id from app.entities where id=${id} for update`;
      if (!rows.length) return null;
    }
    const [r] = await this.tx`select ${this.tx.unsafe(columns)},${
      tagIdsColumn(this.tx, "entity")
    } from app.entities where id=${id}`;
    if (!r) return null;
    return this.label(result(r));
  }
  private async label(row: ReturnType<typeof result>): Promise<EntityValues> {
    const settings = (await this.getBusinessSettings()).settings.entity_identity;
    return {
      ...row,
      source_label: settings?.sources.find((s) => s.code === row.source)?.label ?? row.source,
      ...await entityPresentation(this.tx, row.entity_type_id, row.schema_version, row.properties),
    };
  }
  async insert(i: Parameters<EntityStore["insert"]>[0], generatedIdentity = false) {
    let external_id = i.external_id;
    const insert = () =>
      this.tx`insert into app.entities(id,owner_id,source,external_id,entity_type_id,schema_version,properties)
      values (${
        entityId(i.source, external_id)
      },${this.actor.userId},${i.source},${external_id},${i.entity_type_id},${i.schema_version},${
        this.tx.json(i.properties)
      })
      ${generatedIdentity ? this.tx`on conflict (owner_id,id) do nothing` : this.tx``} returning ${
        this.tx.unsafe(columns)
      }`;
    let first = true;
    const row = generatedIdentity
      ? await insertWithIdRetry(async () => {
        if (!first) external_id = await this.issueDataId();
        first = false;
        return await insert();
      })
      : (await insert())[0];
    const entity = result(row);
    await setTagLinks(this.tx, this.actor, "entity", entity.id, i.tag_ids ?? []);
    return (await this.get(entity.id))!;
  }
  async update(id: string, changes: Omit<EntityUpdate, "expected_version" | "change_note" | "change_tag_ids">) {
    if (changes.tag_ids !== undefined) await setTagLinks(this.tx, this.actor, "entity", id, changes.tag_ids);
    await this.tx`update app.entities set schema_version=${changes.schema_version},
      properties=${changes.properties === undefined ? this.tx`properties` : this.tx.json(changes.properties)},
      version=version+1,updated_at=now() where id=${id}`;
    return (await this.get(id))!;
  }
  async delete(id: string) {
    await this.tx`update app.entities set deleted_at=now(),version=version+1,updated_at=now() where id=${id}`;
  }
  async restore(id: string, changes: EntityCreate) {
    const { source: _source, external_id: _external, expected_version: _version, ...props } = changes;
    await this.tx`update app.entities set deleted_at=null where id=${id}`;
    return this.update(id, props);
  }
  async rekey(id: string, identity: { source: string; external_id: string }) {
    const next = `${identity.source}:${identity.external_id}`;
    await this.tx`select app.rekey_entity(${id},${identity.source},${identity.external_id})`;
    return (await this.get(next))!;
  }
  async list(q: EntityQuery, after?: Keyset) {
    const tx = this.tx;
    const title =
      tx`properties->>(select display->>'representative' from app.entity_schema_versions v where v.owner_id=entities.owner_id and v.type_id=entities.entity_type_id and v.schema_version=entities.schema_version)`;
    const key = q.sort === "title" ? title : tx`updated_at`;
    const at = after ? q.sort === "updated_at" ? tx`${after.at}::timestamptz` : tx`${after.at}` : tx``;
    const descending = q.sort === "updated_at";
    const rows =
      (await tx`select ${tx.unsafe(columns)},${tagIdsColumn(tx, "entity")} from app.entities where deleted_at is null
      ${q.entity_type_id ? tx`and entity_type_id=${q.entity_type_id}::uuid` : tx``}
      ${q.tag_id ? tx`and ${hasTag(tx, "entity", q.tag_id)}` : tx``}
      ${
        q.keyword
          ? tx`and (position(lower(${q.keyword}) in lower(${title}))>0 or position(lower(${q.keyword}) in lower(external_id))>0 or position(lower(${q.keyword}) in lower(source))>0)`
          : tx``
      }
      ${
        after
          ? descending ? tx`and (${key},id)<(${at},${after.id}::text)` : tx`and (${key},id)>(${at},${after.id}::text)`
          : tx``
      }
      order by ${key} ${descending ? tx`desc` : tx`asc`}, id ${descending ? tx`desc` : tx`asc`} limit ${q.limit}`).map(
        result,
      );
    return Promise.all(rows.map(async (row): Promise<EntitySummary> => {
      const { properties: _values, ...summary } = await this.label(row);
      return summary;
    }));
  }
  async related(id: string): Promise<Pick<EntityDetail, "tasks" | "records">> {
    const load = async (table: "tasks" | "records") => {
      const tx = this.tx;
      const membership = tx`entity_ids @> array[${id}::text]`;
      const [count] = await tx`select count(*)::integer as count from app.${tx(table)} where ${membership}`;
      const rows = await tx`select id,updated_at ${
        table === "records" ? tx`,body,record_kind,occurred_at` : tx`,title`
      } from app.${tx(table)} where ${membership} order by updated_at desc,id desc limit 5`;
      return {
        count: count.count as number,
        rows,
      };
    };
    const tasks = await load("tasks"), records = await load("records");
    const item = (r: Record<string, unknown>) => ({
      id: r.id as string,
      title: r.title as string,
      updated_at: (r.updated_at as Date).toISOString(),
    });
    return {
      tasks: { count: tasks.count, items: tasks.rows.map(item) },
      records: {
        count: records.count,
        items: records.rows.map((r) => ({
          id: r.id as string,
          body: r.body as string,
          updated_at: (r.updated_at as Date).toISOString(),
          record_kind: r.record_kind as EntityDetail["records"]["items"][number]["record_kind"],
          occurred_at: (r.occurred_at as Date).toISOString(),
        })),
      },
    };
  }
}
export class SqlEntityUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: EntityStore) => Promise<T>): Promise<T> {
    return runAsActor(this.sql, a, (tx) => fn(new SqlEntityStore(tx, a)));
  }
}
