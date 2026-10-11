import { entityId } from "../../contracts/entity-identity.ts";
import { insertWithIdRetry } from "./data-id.ts";
import type postgres from "postgres";
import type { EntityCreate, EntityDetail, EntityQuery, EntityResult, EntityUpdate } from "../../contracts/entity.ts";
import type { EntityStore } from "../../core/entity/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { Keyset } from "../../core/shared/store.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
import { hasTag, setTagLinks, tagIdsColumn } from "./tag-links.ts";
const columns = "id,source,external_id,deleted_at,prop1,prop2,prop3,prop4,version,created_at,updated_at";
function result(r: Record<string, unknown>): EntityResult {
  return {
    tag_ids: (r.tag_ids as string[]) ?? [],
    id: r.id as string,
    source: r.source as string,
    external_id: r.external_id as string,
    source_label: r.source as string,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : null,
    prop1: r.prop1 as string,
    prop2: r.prop2 as number | null,
    prop3: r.prop3 instanceof Date ? r.prop3.toISOString().slice(0, 10) : r.prop3 as string | null,
    prop4: r.prop4 as EntityResult["prop4"],
    version: r.version as number,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
  };
}
export class SqlEntityStore extends SqlActorStore implements EntityStore {
  async get(id: string, lock = false) {
    if (lock) {
      const rows = await this.tx`select id from app.entities where id=${id} for update`;
      if (!rows.length) return null;
    }
    const [r] = await this.tx`select ${this.tx.unsafe(columns)},${
      tagIdsColumn(this.tx, "entity")
    } from app.entities where id=${id}`;
    if (!r) return null;
    return this.label(result(r));
  }
  private async label(row: EntityResult) {
    const settings = (await this.getBusinessSettings()).settings.entity_identity;
    return { ...row, source_label: settings?.sources.find((s) => s.code === row.source)?.label ?? row.source };
  }
  async insert(i: Parameters<EntityStore["insert"]>[0], generatedIdentity = false) {
    let external_id = i.external_id;
    const insert = () =>
      this.tx`insert into app.entities(id,owner_id,source,external_id,prop1,prop2,prop3,prop4)
      values (${
        entityId(i.source, external_id)
      },${this.actor.userId},${i.source},${external_id},${i.prop1},${i.prop2},${i.prop3},${i.prop4})
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
    const values = Object.fromEntries(
      Object.entries(changes).filter(([k, v]) => ["prop1", "prop2", "prop3", "prop4"].includes(k) && v !== undefined),
    );
    if (Object.keys(values).length) {
      await this.tx`update app.entities set ${this.tx(values)},version=version+1,updated_at=now() where id=${id}`;
    } else await this.tx`update app.entities set version=version+1,updated_at=now() where id=${id}`;
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
    const key = q.sort === "prop2"
      ? tx`coalesce(prop2,-1)`
      : q.sort === "prop3"
      ? tx`coalesce(prop3,date '0001-01-01 BC')`
      : q.sort === "prop1"
      ? tx`prop1`
      : tx`updated_at`;
    const at = after
      ? q.sort === "prop2"
        ? tx`${Number(after.at)}`
        : q.sort === "prop3"
        ? after.at === "0000-01-01" ? tx`date '0001-01-01 BC'` : tx`${after.at}::date`
        : q.sort === "updated_at"
        ? tx`${after.at}::timestamptz`
        : tx`${after.at}`
      : tx``;
    const descending = q.sort === "updated_at";
    const rows =
      (await tx`select ${tx.unsafe(columns)},${tagIdsColumn(tx, "entity")} from app.entities where deleted_at is null
      ${q.tag_id ? tx`and ${hasTag(tx, "entity", q.tag_id)}` : tx``}
      ${
        q.keyword
          ? tx`and (position(lower(${q.keyword}) in lower(prop1))>0 or position(lower(${q.keyword}) in lower(external_id))>0 or position(lower(${q.keyword}) in lower(source))>0)`
          : tx``
      }
      ${q.prop4 ? tx`and prop4=${q.prop4}` : tx``}
      ${q.prop3_from ? tx`and prop3>=${q.prop3_from}::date` : tx``}
      ${q.prop3_to ? tx`and prop3<=${q.prop3_to}::date` : tx``}
      ${
        after
          ? descending ? tx`and (${key},id)<(${at},${after.id}::text)` : tx`and (${key},id)>(${at},${after.id}::text)`
          : tx``
      }
      order by ${key} ${descending ? tx`desc` : tx`asc`}, id ${descending ? tx`desc` : tx`asc`} limit ${q.limit}`).map(
        result,
      );
    return Promise.all(rows.map((row) => this.label(row)));
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
