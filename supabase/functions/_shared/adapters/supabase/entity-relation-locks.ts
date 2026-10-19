import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { RelationEntry } from "../../core/entity-relations/links.ts";
import { notFound } from "../../core/shared/errors.ts";
import { loadBusinessEntityDefinition } from "./entity-values.ts";
import { authorizeWorkspace, requireWorkspaceActor } from "./workspace-context.ts";

/** UTF-8 byte order equals Unicode scalar order; JS UTF-16 order does not. */
export function compareEntityIds(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0)!), right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
/** Pre-receipt authority uses stored immutable affiliation, never supplied kind claims. */
export async function authorizeRelation(tx: postgres.TransactionSql, a: Actor, entry: RelationEntry) {
  const workspace = requireWorkspaceActor(a).workspaceId;
  const [r] = await tx`select app.business_relation_definition(${entry.definitionId}::uuid,${
    entry.access === "write"
  }) as definition`;
  if (!r.definition) throw notFound();
  const ids = [...new Set(entry.endpointIds)];
  const rows = ids.length
    ? await tx`select id,entity_type_id from app.entities where workspace_id=${workspace} and id=any(${ids}::text[])`
    : [];
  if (rows.length !== ids.length) throw notFound();
  const kinds = [
    ...new Set<string>(
      [
        r.definition.left_type_id,
        r.definition.right_type_id,
        ...(entry.typeIds ?? []),
        ...rows.map((row) => String(row.entity_type_id)),
      ].filter((value) => typeof value === "string"),
    ),
  ].sort();
  const requirements = kinds.map((target_id) => ({
    target_kind: "entity_type" as const,
    target_id,
    access: entry.access,
  }));
  await authorizeWorkspace(tx, requirements);
  await tx`select set_config('request.workspace_requirements',${JSON.stringify(requirements)},true)`;
  if (entry.access === "write") {
    for (const kind of kinds) if (!await loadBusinessEntityDefinition(tx, kind, true)) throw notFound();
  }
}
export async function lockEndpoints(tx: postgres.TransactionSql, ids: string[]) {
  if (!ids.length) return;
  const rows = await tx<
    { id: string; entity_type_id: string }[]
  >`select id,entity_type_id from app.entities where workspace_id=app.current_workspace_id() and id=any(${ids}::text[])`;
  for (const kind of [...new Set(rows.map((row) => row.entity_type_id))].sort()) {
    await loadBusinessEntityDefinition(tx, kind, true);
  }
  for (const id of rows.map((row) => row.id).sort(compareEntityIds)) {
    await tx`select id from app.entities where workspace_id=app.current_workspace_id() and id=${id} for update`;
  }
}
