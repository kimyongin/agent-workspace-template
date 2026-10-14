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
