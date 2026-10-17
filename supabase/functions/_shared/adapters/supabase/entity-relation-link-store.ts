import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntitySummary } from "../../contracts/entity.ts";
import type { EntityRelationLinkStore } from "../../core/entity-relations/links.ts";
import { SqlEntityRelationDefinitionStore } from "./entity-relation-definition-store.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { lockEndpoints } from "./entity-pair-locks.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";
export class SqlEntityRelationLinkStore extends SqlActorStore implements EntityRelationLinkStore {
  definition(id: string, lock: boolean) {
    const definitions = new SqlEntityRelationDefinitionStore(this.tx, this.actor);
    return lock ? definitions.lock(id) : definitions.get(id);
  }
  async endpoints(ids: string[], lock: boolean) {
    if (lock) await lockEndpoints(this.tx, ids);
    const store = new SqlEntityStore(this.tx, this.actor);
    return (await Promise.all(ids.map((id) => store.get(id)))).filter((e) => e !== null);
  }
  async linkedIds(definition: string, side: 0 | 1, origin: string) {
    const column = side === 0 ? this.tx`left_entity_id` : this.tx`right_entity_id`,
      peer = side === 0 ? this.tx`right_entity_id` : this.tx`left_entity_id`;
    const rows = await this
      .tx`select ${peer} as id from app.entity_relation_links where definition_id=${definition}::uuid and ${column}=${origin} order by ${peer} collate "C"`;
    return rows.map((r) => r.id as string);
  }
  async exists(definition: string, left: string, right: string) {
    const [r] = await this
      .tx`select 1 from app.entity_relation_links where definition_id=${definition}::uuid and left_entity_id=${left} and right_entity_id=${right}`;
    return !!r;
  }
  async count(definition: string, side: 0 | 1, origin: string) {
    const column = side === 0 ? this.tx`left_entity_id` : this.tx`right_entity_id`;
    const [r] = await this
      .tx`select count(*)::int n from app.entity_relation_links where definition_id=${definition}::uuid and ${column}=${origin}`;
    return r.n as number;
  }
  async apply(
    definition: string,
    side: 0 | 1,
    origin: string,
    other: string,
    linked: boolean,
    previous: string | null,
  ) {
    const [left, right] = side === 0 ? [origin, other] : [other, origin];
    if (previous) {
      const [l, r] = side === 0 ? [origin, previous] : [previous, origin];
      await this
        .tx`delete from app.entity_relation_links where definition_id=${definition}::uuid and left_entity_id=${l} and right_entity_id=${r}`;
    }
    if (linked) {
      await this
        .tx`insert into app.entity_relation_links(owner_id,definition_id,left_entity_id,right_entity_id) values(${this.actor.userId},${definition},${left},${right})`;
    } else {await this
        .tx`delete from app.entity_relation_links where definition_id=${definition}::uuid and left_entity_id=${left} and right_entity_id=${right}`;}
    const ids = [...new Set([origin, other, ...(previous ? [previous] : [])])];
    await this.tx`update app.entities set version=version+1,updated_at=now() where id=any(${ids}::text[])`;
  }
  async list(
    q: Parameters<EntityRelationLinkStore["list"]>[0],
    after: string | undefined,
    candidates: boolean,
  ): Promise<EntitySummary[]> {
    const t = this.tx,
      own = q.side === 0 ? t`l.left_entity_id` : t`l.right_entity_id`,
      peer = q.side === 0 ? t`l.right_entity_id` : t`l.left_entity_id`;
    const otherSlot = q.side === 0 ? t`p.right_entity_id` : t`p.left_entity_id`,
      kind = q.side === 0 ? t`d.right_type_id` : t`d.left_type_id`,
      card = q.side === 0 ? t`d.right_cardinality` : t`d.left_cardinality`;
    const ids = candidates
      ? await t`select e.id from app.entities e join app.entity_types k on k.owner_id=e.owner_id and k.id=e.entity_type_id join app.entity_schema_versions v on v.owner_id=k.owner_id and v.type_id=k.id and v.schema_version=k.schema_version cross join app.entity_relation_definitions d
 where d.id=${q.definition_id}::uuid and e.entity_type_id=${kind} and e.id<>${q.origin_id} and e.deleted_at is null and not coalesce((v.schema->>'deprecated')::boolean,false)
 and not exists(select 1 from app.entity_relation_links l where l.definition_id=d.id and ${own}=${q.origin_id} and ${peer}=e.id)
 and (${card}<>'one' or not exists(select 1 from app.entity_relation_links p where p.definition_id=d.id and ${otherSlot}=e.id))
 and (${q.q}='' or strpos(lower(coalesce(e.properties->>(select key from jsonb_each(v.schema->'properties') where value->>'x-representative'='true' limit 1),'')),lower(${q.q}))>0 or strpos(lower(e.external_id),lower(${q.q}))>0)
 and (${after ?? null}::text is null or e.id collate "C">${
        after ?? null
      } collate "C") order by e.id collate "C" limit ${q.limit + 1}`
      : await t`select e.id from app.entity_relation_links l join app.entities e on e.owner_id=l.owner_id and e.id=${peer}
        join app.entity_types k on k.owner_id=e.owner_id and k.id=e.entity_type_id
        join app.entity_schema_versions v on v.owner_id=k.owner_id and v.type_id=k.id and v.schema_version=k.schema_version
        where l.definition_id=${q.definition_id}::uuid and ${own}=${q.origin_id}
        and (${q.q}='' or strpos(lower(coalesce(e.properties->>(select key from jsonb_each(v.schema->'properties') where value->>'x-representative'='true' limit 1),'')),lower(${q.q}))>0 or strpos(lower(e.external_id),lower(${q.q}))>0)
        and (${after ?? null}::text is null or e.id collate "C">${
        after ?? null
      } collate "C") order by e.id collate "C" limit ${q.limit + 1}`;
    const store = new SqlEntityStore(t, this.actor);
    const values = await Promise.all(ids.map((r) => store.get(String(r.id))));
    return values.filter((e) => e !== null).map((e) => {
      const { properties, ...summary } = e;
      void properties;
      return summary;
    });
  }
}
export class SqlEntityRelationLinkUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  read<T>(actor: Actor, fn: (s: EntityRelationLinkStore) => Promise<T>) {
    return runAsActor(
      this.sql,
      actor,
      (tx) => fn(new SqlEntityRelationLinkStore(tx, actor)),
      "repeatable read read only",
    );
  }
  run<T>(actor: Actor, fn: (s: EntityRelationLinkStore) => Promise<T>) {
    return runAsActor(this.sql, actor, (tx) => fn(new SqlEntityRelationLinkStore(tx, actor)));
  }
}
