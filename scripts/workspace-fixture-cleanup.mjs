import { createHash } from "node:crypto";

const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateWorkspaceCleanupManifest(manifest) {
  const environment = manifest?.environment;
  if (!manifest || typeof manifest.run_id !== "string" || !manifest.run_id.trim()
    || !/^[a-f0-9]{40}$/.test(manifest.source_revision ?? "")
    || typeof manifest.project_id !== "string" || !manifest.project_id.trim()
    || !environment || typeof environment.name !== "string" || !environment.name.trim()
    || !Number.isInteger(environment.port) || environment.port < 1 || environment.port > 65535
    || typeof environment.database !== "string" || !environment.database
    || !uuid.test(manifest.workspace?.id ?? "") || !uuid.test(manifest.workspace?.created_by ?? "")
    || typeof manifest.workspace?.name !== "string" || !manifest.workspace.name
    || !Array.isArray(manifest.member_ids) || !manifest.member_ids.length
    || manifest.member_ids.some((id) => !uuid.test(id))
    || new Set(manifest.member_ids).size !== manifest.member_ids.length
    || !Array.isArray(manifest.disposable_effect_ids)
    || manifest.disposable_effect_ids.some((id) => typeof id !== "string" || !id)
    || new Set(manifest.disposable_effect_ids).size !== manifest.disposable_effect_ids.length) {
    throw new Error("explicit owned workspace cleanup manifest required");
  }
  if (!["127.0.0.1", "localhost"].includes(environment.host)) throw new Error("cleanup requires explicit loopback store");
  return manifest;
}

/** Plan disposal of one explicitly created, exclusively run-owned workspace. */
export function planWorkspaceCleanup(manifest, inventory) {
  validateWorkspaceCleanupManifest(manifest);
  const workspace = manifest.workspace.id;
  const selection = Object.fromEntries(Object.entries(inventory).map(([table, rows]) => [
    table,
    rows.filter((row) => table === "app.workspaces" ? row.id === workspace
      : table.startsWith("pgmq.") ? row.message?.workspace_id === workspace
      : row.workspace_id === workspace)
      .sort((a, b) => canonical(a).localeCompare(canonical(b))),
  ]));
  const blockers = [];
  const roots = selection["app.workspaces"] ?? [];
  if (roots.length !== 1 || roots[0].name !== manifest.workspace.name || roots[0].created_by !== manifest.workspace.created_by) {
    blockers.push({ reason: "workspace_identity_changed" });
  }
  for (const row of selection["private.workspace_members"] ?? []) {
    if (!manifest.member_ids.includes(row.user_id)) blockers.push({ reason: "unexpected_member", id: row.user_id });
  }
  for (const row of selection["private.passage_effects"] ?? []) {
    if (!["succeeded", "failed"].includes(row.state) && !manifest.disposable_effect_ids.includes(row.id)) {
      blockers.push({ reason: "unresolved_effect", id: row.id });
    }
  }
  const report = {
    workspace_id: workspace,
    blockers,
    counts: Object.fromEntries(Object.entries(selection).map(([table, rows]) => [table, rows.length])),
    effect_ids: (selection["private.passage_effects"] ?? []).map((row) => row.id).sort(),
    digest: createHash("sha256").update(canonical({ manifest, selection })).digest("hex"),
  };
  Object.defineProperty(report, "selection", { value: selection });
  return report;
}
