import { entityId } from "../../contracts/entity-identity.ts";
import { insertWithIdRetry } from "./data-id.ts";
import type postgres from "postgres";
import type { EntityCreate, EntityDetail, EntityQuery, EntityUpdate, EntityValues } from "../../contracts/entity.ts";
import { entityPresentationRow, loadEntityDefinition } from "./entity-values.ts";
import type { EntityStore } from "../../core/entity/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { type EntityKeyset, fieldKind } from "../../core/entity/list-rules.ts";
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
  definition(typeId: string, lock = false) {
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
    const [r] = await this.tx`select ${this.projection()} from ${this.joined()} where entities.id=${id}`;
    return r ? this.present(r) : null;
  }
  private projection() {
    const tx = this.tx;
    return tx`${tx.unsafe(columns.split(",").map((name) => "entities." + name).join(","))},${
      tagIdsColumn(tx, "entity")
    },
      t.id as type_id,t.label,t.icon_id,t.archived,t.schema_version as current_schema_version,v.display,
      b.settings as identity_settings`;
  }
  private joined() {
    const tx = this.tx;
    return tx`app.entities join app.entity_types t on t.owner_id=entities.owner_id and t.id=entities.entity_type_id
      join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
      left join app.user_business_settings b on b.owner_id=entities.owner_id and b.id='entity_identity'`;
  }
  private present(r: Record<string, unknown>): EntityValues {
    const row = result(r),
      settings = r.identity_settings as { sources?: Array<{ code: string; label: string }> } | null;
    return {
      ...row,
      source_label: settings?.sources?.find((source) => source.code === row.source)?.label ?? row.source,
      ...entityPresentationRow(r, row.properties),
    };
  }
  async listRevisions(typeId?: string) {
    const tx = this.tx;
    // Shared type locks keep revision resolution and query on the same publication epoch.
    // Reading during preparation remains allowed; only the atomic pointer commit waits.
    const rows = await tx`select id,version,schema_version from app.entity_types ${
      typeId ? tx`where id=${typeId}::uuid` : tx``
    } order by id for share`;
    return rows.map((row) => ({
      id: String(row.id),
      type_version: Number(row.version),
      schema_version: Number(row.schema_version),
    }));
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
  async list(q: EntityQuery, after?: EntityKeyset, typeIds?: string[]) {
    const tx = this.tx;
    const definition = q.entity_type_id ? await this.definition(q.entity_type_id) : null;
    const title = tx`entities.properties->>(v.display->>'representative')`;
    const scalar = (key: string) => {
      const field = definition!.schema.properties[key], kind = fieldKind(field);
      const json = tx`entities.properties->${key}::text`, value = tx`entities.properties->>${key}::text`;
      // CASE is essential: PostgreSQL may reorder AND predicates before casting unrelated type rows.
      return kind === "integer" || kind === "number"
        ? tx`case when jsonb_typeof(${json})='number' then (${value})::numeric end`
        : kind === "boolean"
        ? tx`case when jsonb_typeof(${json})='boolean' then (${value})::boolean end`
        : tx`case when jsonb_typeof(${json})='string' then ${value} end`;
    };
    const property = typeof q.sort === "object" ? q.sort : null;
    const key = property ? scalar(property.key) : q.sort === "title" ? title : tx`entities.updated_at`;
    // Missing < explicit null < scalar in ascending order; descending reverses the tuple.
    const category = property
      ? tx`case when not (entities.properties ? ${property.key}) then 0 when entities.properties->${property.key}::text='null'::jsonb then 1 else 2 end`
      : tx`2`;
    const descending = property ? property.direction === "desc" : q.sort === "updated_at";
    const direction = descending ? tx`desc` : tx`asc`, compare = descending ? tx`<` : tx`>`;
    const filters = (q.filters ?? []).map((filter) => {
      const json = tx`entities.properties->${filter.key}::text`;
      if (filter.operator === "unset") {
        return tx`and (not (entities.properties ? ${filter.key}) or ${json}='null'::jsonb)`;
      }
      if (!("value" in filter)) throw new Error("Unsupported filter");
      const value = scalar(filter.key);
      if (filter.operator === "contains") return tx`and position(${filter.value} in ${value})>0`;
      const operators = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
      return tx`and ${value} ${tx.unsafe(operators[filter.operator])} ${filter.value}`;
    });
    const at = after ? q.sort === "updated_at" ? tx`${after.at}::timestamptz` : tx`${after.at}` : tx``;
    const boundary = !after
      ? tx``
      : after.category < 2
      ? tx`and (${category} ${compare} ${after.category} or (${category}=${after.category} and entities.id ${compare} ${after.id}))`
      : tx`and (${category} ${compare} ${after.category} or (${category}=${after.category} and (${key},entities.id) ${compare} (${at},${after.id}::text)))`;
    const rows = await tx`select ${this.projection()},${category} as sort_category,${key} as sort_at
      from ${this.joined()} where entities.deleted_at is null
      ${typeIds ? tx`and entities.entity_type_id=any(${typeIds}::uuid[])` : tx``}
      ${q.entity_type_id ? tx`and entities.entity_type_id=${q.entity_type_id}::uuid` : tx``}
      ${q.tag_id ? tx`and ${hasTag(tx, "entity", q.tag_id)}` : tx``}
      ${
      q.link_candidate_for
        ? tx`and not t.archived and entities.id<>${q.link_candidate_for} and not exists(select 1 from app.entity_pairs p where (p.entity_id=${q.link_candidate_for} and p.other_id=entities.id) or (p.other_id=${q.link_candidate_for} and p.entity_id=entities.id))`
        : tx``
    }
      ${
      q.keyword
        ? tx`and (position(lower(${q.keyword}) in lower(${title}))>0 or position(lower(${q.keyword}) in lower(entities.external_id))>0 or position(lower(${q.keyword}) in lower(entities.source))>0 ${
          q.link_candidate_for ? tx`or position(lower(${q.keyword}) in lower(t.label))>0` : tx``
        })`
        : tx``
    }
      ${filters.reduce((all, filter) => tx`${all} ${filter}`, tx``)} ${boundary}
      order by ${category} ${direction},${key} ${direction},entities.id ${direction} limit ${q.limit}`;
    return rows.map((row) => {
      const { properties: _values, ...summary } = this.present(row);
      const kind = property ? fieldKind(definition!.schema.properties[property.key]) : null;
      const at = row.sort_at instanceof Date
        ? row.sort_at.toISOString()
        : row.sort_at === null
        ? null
        : kind === "number" || kind === "integer"
        ? Number(row.sort_at)
        : row.sort_at;
      return {
        ...summary,
        _cursor: {
          at: at as EntityKeyset["at"],
          category: Number(row.sort_category) as EntityKeyset["category"],
          id: summary.id,
        },
      };
    });
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
