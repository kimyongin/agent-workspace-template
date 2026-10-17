import type postgres from "postgres";
import { loadEntityDefinition } from "./entity-values.ts";

/** UTF-8 byte order equals Unicode scalar order; JS UTF-16 order does not. */
export function compareEntityIds(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!), right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
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
