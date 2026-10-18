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
      : row.workspace_id === workspace || table === "private.workspace_request_results" && row.result_workspace_id === workspace)
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

async function inventoryFor(sql, workspace) {
  const inventory = {
    "app.workspaces": await sql`select * from app.workspaces where id=${workspace}`,
  };
  // Schema catalog discovery keeps new scoped derived tables in the same
  // ownership boundary. Auth and account metadata are outside these schemas.
  const tables = await sql`select n.nspname as schema,c.relname as name
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where a.attname='workspace_id' and not a.attisdropped
      and n.nspname in ('app','private') and c.relkind in ('r','p') and not c.relispartition
    order by n.nspname,c.relname`;
  for (const { schema, name } of tables) {
    const table = `${schema}.${name}`;
    inventory[table] = table === "private.workspace_request_results"
      ? await sql`select * from ${sql(table)} where workspace_id=${workspace} or result_workspace_id=${workspace}`
      : await sql`select * from ${sql(table)} where workspace_id=${workspace}`;
  }
  for (const table of ["pgmq.q_search_index", "pgmq.a_search_index"]) {
    inventory[table] = await sql`select * from ${sql(table)} where message->>'workspace_id'=${workspace}`;
  }
  return inventory;
}

/** Inventory and apply both verify the connection's parsed store identity. */
export async function runWorkspaceCleanup(sql, manifest, approvedReport) {
  validateWorkspaceCleanupManifest(manifest);
  if (approvedReport && (approvedReport.workspace_id !== manifest.workspace.id
    || !/^[a-f0-9]{64}$/.test(approvedReport.digest ?? "")
    || !Array.isArray(approvedReport.effect_ids)
    || approvedReport.effect_ids.some((id) => typeof id !== "string" || !id))) {
    throw new Error("explicit matching cleanup approval required");
  }
  const { host, port, database } = sql.options ?? {};
  if (!Array.isArray(host) || host.length !== 1 || host[0] !== manifest.environment.host
    || !Array.isArray(port) || port.length !== 1 || port[0] !== manifest.environment.port
    || database !== manifest.environment.database) {
    throw new Error("cleanup connection does not match explicit manifest store");
  }
  return await sql.begin(async (tx) => {
    if (!approvedReport) await tx`set transaction isolation level repeatable read, read only`;
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='30s'`;
    if (approvedReport) await tx`select id from app.workspaces where id=${manifest.workspace.id} for update`;
    const inventory = await inventoryFor(tx, manifest.workspace.id);
    const report = planWorkspaceCleanup(manifest, inventory);
    if (!approvedReport) return { mode: "dry-run", ...report };
    const captured = approvedReport.effect_ids;
    if (!inventory["app.workspaces"].length) {
      const effects = captured.length
        ? await tx`select id from private.passage_effects where id=any(${captured}::uuid[])`
        : [];
      if (Object.values(report.counts).some((count) => count !== 0) || effects.length) {
        throw new Error("owned workspace cleanup has residual references");
      }
      return { mode: "already-clean", ...approvedReport, residual_rows: 0 };
    }
    if (approvedReport.digest !== report.digest) throw new Error("cleanup approval digest changed; repeat dry-run");
    if (report.blockers.length) throw new Error("owned workspace cleanup blocked by changed ownership or unresolved work");
    if (captured.length !== report.effect_ids.length || captured.some((id) => !report.effect_ids.includes(id))) {
      throw new Error("cleanup approval effect identity changed");
    }
    if (captured.length) {
      await tx`delete from private.passage_effects where workspace_id=${manifest.workspace.id} and id=any(${captured}::uuid[])`;
    }
    for (const table of ["pgmq.q_search_index", "pgmq.a_search_index"]) {
      const ids = inventory[table].map((row) => row.msg_id);
      if (ids.length) await tx`delete from ${tx(table)} where message->>'workspace_id'=${manifest.workspace.id} and msg_id=any(${ids}::bigint[])`;
    }
    await tx`delete from app.workspaces where id=${manifest.workspace.id} and name=${manifest.workspace.name} and created_by=${manifest.workspace.created_by}`;
    const after = await inventoryFor(tx, manifest.workspace.id);
    const effects = captured.length
      ? await tx`select id from private.passage_effects where id=any(${captured}::uuid[])`
      : [];
    if (Object.values(after).some((rows) => rows.length) || effects.length) throw new Error("owned workspace cleanup has residual references");
    return { mode: "applied", ...report, residual_rows: 0 };
  });
}
