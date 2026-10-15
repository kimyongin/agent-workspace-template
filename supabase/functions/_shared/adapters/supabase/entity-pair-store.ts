import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityPairStore } from "../../core/entity-pairs/application.ts";
import type { EntitySummary } from "../../contracts/entity.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { entityPresentationRow } from "./entity-values.ts";
import { lockEndpoints, lockEntityPairs } from "./entity-pair-locks.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";

export class SqlEntityPairStore extends SqlActorStore implements EntityPairStore {
  async endpoints(ids: string[], lock: boolean) {
    if (lock) {
      await lockEntityPairs(this.tx, this.actor);
      await lockEndpoints(this.tx, ids);
    }
    const store = new SqlEntityStore(this.tx, this.actor);
    const values = await Promise.all(ids.map((id) => store.get(id)));
    return values.filter((v) => v !== null);
  }
  async exists(left: string, right: string) {
    const [row] = await this.tx`select 1 from app.entity_pairs where entity_id=${left} and other_id=${right}`;
    return !!row;
  }
  async count(id: string) {
    const [row] = await this
      .tx`select count(*)::integer as count from app.entity_pairs where entity_id=${id} or other_id=${id}`;
    return Number(row.count);
  }
  async change(left: string, right: string, linked: boolean) {
    if (linked) {
      await this
        .tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${this.actor.userId},${left},${right})`;
    } else await this.tx`delete from app.entity_pairs where entity_id=${left} and other_id=${right}`;
    await this.tx`update app.entities set version=version+1,updated_at=now() where id in (${left},${right})`;
  }
  async list(id: string, limit: number, after?: string) {
    const tx = this.tx;
    const rows =
      await tx`select e.*,t.id as type_id,v.schema->>'title' as label,v.schema->>'x-icon' as icon_id,coalesce((v.schema->>'deprecated')::boolean,false) as archived,t.schema_version as current_schema_version,v.schema,
      coalesce((select jsonb_agg(tag_id order by tag_id) from app.entity_tags where owner_id=e.owner_id and entity_id=e.id),'[]'::jsonb) as tag_ids,
      issuer.label as source_label
      from app.entity_pairs p join app.entities e on e.owner_id=p.owner_id
      and e.id=case when p.entity_id=${id} then p.other_id else p.entity_id end
      join app.entity_types t on t.owner_id=e.owner_id and t.id=e.entity_type_id
      join app.entity_schema_versions v on v.owner_id=t.owner_id and v.type_id=t.id and v.schema_version=t.schema_version
      join app.entity_issuers issuer on issuer.owner_id=e.owner_id and issuer.code=e.source
      where (p.entity_id=${id} or p.other_id=${id}) ${after ? tx`and e.id collate "C">${after} collate "C"` : tx``}
      order by e.id collate "C" limit ${limit}`;
    return rows.map((r): EntitySummary => ({
      id: r.id,
      source: r.source,
      external_id: r.external_id,
      source_label: r.source_label,
      entity_type_id: r.entity_type_id,
      schema_version: Number(r.schema_version),
      ...entityPresentationRow(r, r.properties),
      tag_ids: r.tag_ids,
      version: r.version,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
      deleted_at: r.deleted_at?.toISOString() ?? null,
    }));
  }
}
export class SqlEntityPairUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: EntityPairStore) => Promise<T>) {
    return runAsActor(this.sql, a, (tx) => fn(new SqlEntityPairStore(tx, a)));
  }
}
