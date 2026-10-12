import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { EntityPairStore } from "../../core/entity-pairs/application.ts";
import { compareEntityIds } from "../../contracts/entity-pairs.ts";
import { SqlEntityStore } from "./entity-store.ts";
import { loadEntityDefinition } from "./entity-values.ts";
import { runAsActor, SqlActorStore } from "./sql-context.ts";

export async function lockEntityPairs(tx: postgres.TransactionSql, actor: Actor) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${actor.userId}:entity_pairs`},0))`;
}
async function lockEndpoints(tx: postgres.TransactionSql, ids: string[]) {
  const rows = await tx<
    { id: string; entity_type_id: string }[]
  >`select id,entity_type_id from app.entities where id in ${tx(ids)}`;
  for (const type of [...new Set(rows.map((r) => r.entity_type_id))].sort()) await loadEntityDefinition(tx, type, true);
  for (const id of rows.map((r) => r.id).sort(compareEntityIds)) {
    await tx`select id from app.entities where id=${id} for update`;
  }
}
/** Acquire pair membership first, then the complete type/endpoint neighborhood before the origin lock. */
export async function prepareEntityPairRekey(tx: postgres.TransactionSql, actor: Actor, id: string) {
  await lockEntityPairs(tx, actor);
  const peers = await tx<{ id: string }[]>`select case when entity_id=${id} then other_id else entity_id end as id
    from app.entity_pairs where entity_id=${id} or other_id=${id}`;
  await lockEndpoints(tx, [id, ...peers.map((r) => r.id)]);
}
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
    const rows = await tx`select e.id from app.entity_pairs p join app.entities e on e.owner_id=p.owner_id
      and e.id=case when p.entity_id=${id} then p.other_id else p.entity_id end
      where (p.entity_id=${id} or p.other_id=${id}) ${after ? tx`and e.id collate "C">${after} collate "C"` : tx``}
      order by e.id collate "C" limit ${limit}`;
    const store = new SqlEntityStore(tx, this.actor);
    const items = await Promise.all(rows.map((r) => store.get(String(r.id))));
    return items.filter((e) => e !== null).map(({ properties: _properties, ...summary }) => summary);
  }
}
export class SqlEntityPairUnitOfWork {
  constructor(private readonly sql: postgres.Sql) {}
  run<T>(a: Actor, fn: (s: EntityPairStore) => Promise<T>) {
    return runAsActor(this.sql, a, (tx) => fn(new SqlEntityPairStore(tx, a)));
  }
}
