import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import { compareEntityIds } from "../../contracts/entity-pairs.ts";
import { loadEntityDefinition } from "./entity-values.ts";

export async function lockEntityPairs(tx: postgres.TransactionSql, actor: Actor) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${actor.userId}:entity_pairs`},0))`;
}
export async function lockEndpoints(tx: postgres.TransactionSql, ids: string[]) {
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
