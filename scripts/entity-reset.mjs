import { createHash } from "node:crypto";

const canonical = (v) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const hash = (v) => createHash("sha256").update(canonical(v)).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const rows = (inventory, table) => inventory[table] ?? [];
const capturesEntity = (row, ids) => (row.entity_ids ?? []).some((id) => ids.has(id))
  || (row.entity_context ?? []).some((capture) => ids.has(capture.id));
// Only stored reference positions carry identity; labels/defaults/body are values.
const hasEntityReference = (value, ids) => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasEntityReference(item, ids));
  if (["entity_id", "origin_id", "other_id", "previous_other_id"].some((key) => ids.has(value[key]))
    || Array.isArray(value.entity_ids) && value.entity_ids.some((id) => ids.has(id))
    || Array.isArray(value.entity_context) && value.entity_context.some((capture) => ids.has(capture.id))
    || value.target_kind === "entity" && ids.has(value.target_id)
    || typeof value.entity_type_id === "string" && ids.has(value.id)) return true;
  return Object.entries(value).some(([key, child]) => !["properties", "schema", "current_schema", "source_definition", "source_templates", "target", "plan"].includes(key)
    && hasEntityReference(child, ids));
};
const baselineReferences = (baseline, ids) => (baseline?.typed_links ?? []).some((link) => ids.has(link[1]) || ids.has(link[2]))
  || (baseline?.pairs ?? []).some((pair) => ids.has(pair[0]) || ids.has(pair[1]))
  || (baseline?.tasks ?? []).some((task) => (task[1] ?? []).some((id) => ids.has(id)) || (task[2] ?? []).some((capture) => ids.has(capture.id)))
  || (baseline?.records ?? []).some((record) => ids.has(record[2]));
const preparationReferences = (row, ids) => (row.migration?.overrides ?? []).some((override) => ids.has(override.entity_id))
  || baselineReferences(row.source_references, ids) || baselineReferences(row.committed_references, ids);
const entityOperation = (operation) => /^(entity\.(create|restore|update|delete)|entity-relation\.(connect|unlink|replace|create-and-link)|entity-relation-link\.|entity-link\.)/.test(operation ?? "");

// Fixed audited tables only. The manifest cannot introduce SQL or table names.
export const entityResetTables = Object.freeze([
  "app.entities", "app.tasks", "app.records", "app.entity_tags", "app.record_tags", "app.entity_relation_links",
  "app.entity_types", "app.entity_schema_versions", "app.entity_issuers", "app.entity_identifier_rules",
  "app.entity_type_identity", "app.entity_type_identity_sources", "app.entity_relation_definitions",
  "app.data_model_changes", "app.data_model_children", "app.entity_schema_changes", "app.entity_schema_analyses",
  "app.entity_schema_migrations", "private.entity_schema_analysis_rows", "private.entity_schema_migration_rows",
  "app.search_index_state", "app.search_chunks", "private.passage_effects", "private.workspace_request_results",
]);
const legacyKeys = Object.freeze({
  "app.entities": ["owner_id", "id"], "app.entity_types": ["owner_id", "id"],
  "app.entity_schema_versions": ["owner_id", "type_id", "schema_version"],
  "app.entity_issuers": ["owner_id", "code"], "app.entity_identifier_rules": ["owner_id", "id"],
  "app.entity_type_identity": ["owner_id", "type_id"], "app.entity_type_identity_sources": ["owner_id", "type_id", "code"],
  "app.entity_relation_definitions": ["owner_id", "id"],
  "app.entity_relation_links": ["owner_id", "definition_id", "left_entity_id", "right_entity_id"],
  "app.data_model_changes": ["owner_id", "id"], "app.data_model_children": ["owner_id", "model_id", "type_ref"],
  "app.entity_schema_changes": ["owner_id", "id"], "app.entity_schema_analyses": ["owner_id", "id"],
  "app.entity_schema_migrations": ["owner_id", "id"],
  "private.entity_schema_analysis_rows": ["owner_id", "analysis_id", "entity_id"],
  "private.entity_schema_migration_rows": ["owner_id", "job_id", "entity_id"],
});
const queues = ["pgmq.q_search_index", "pgmq.a_search_index"];
const preservedTables = ["app.workspaces", "private.workspace_members", "private.workspace_grants", "private.workspace_invitations",
  "app.user_business_settings", "auth.users"];
const legacyPreconditionTables = Object.keys(legacyKeys);

export function validateEntityResetManifest(m) {
  if (!m || typeof m.run_id !== "string" || !m.run_id.trim() || typeof m.project_id !== "string" || !m.project_id.trim()
    || !/^[a-f0-9]{40}$/.test(m.source_revision ?? "") || !m.environment
    || !Number.isInteger(m.environment.port) || m.environment.port < 1 || m.environment.port > 65535
    || typeof m.environment.database !== "string" || !m.environment.database
    || !Array.isArray(m.scopes) || (!m.scopes.length && !(m.legacy_rows?.length))
    || m.scopes.some((s) => !uuid.test(s.workspace_id ?? "") || !uuid.test(s.actor_id ?? "")
      || !Array.isArray(s.entity_ids) || s.entity_ids.some((id) => typeof id !== "string" || !id)
      || new Set(s.entity_ids).size !== s.entity_ids.length)
    || new Set(m.scopes.map((s) => s.workspace_id)).size !== m.scopes.length) {
    throw new Error("explicit reset run/revision/project/store and exact workspace entity IDs required");
  }
  if (!["127.0.0.1", "localhost"].includes(m.environment.host)) throw new Error("reset requires a loopback store");
  if (new Set((m.legacy_rows ?? []).map(canonical)).size !== (m.legacy_rows ?? []).length) throw new Error("duplicate legacy row identity");
  for (const entry of m.legacy_rows ?? []) {
    const keys = legacyKeys[entry.table];
    if (!keys || !entry.key || Object.keys(entry.key).length !== keys.length
      || keys.some((k) => entry.key[k] === undefined || entry.key[k] === null)
      || !uuid.test(entry.key.owner_id ?? "")) throw new Error("exact allowlisted legacy row identity required");
  }
  return m;
}

/** Pure review seam. Report contains counts/digests, never raw business content. */
export function planEntityReset(manifest, inventory) {
  validateEntityResetManifest(manifest);
  const selection = Object.fromEntries([...entityResetTables, ...queues].map((t) => [t, []]));
  const blockers = [];
  for (const entry of manifest.legacy_rows ?? []) {
    const found = rows(inventory, entry.table).filter((r) => r.workspace_id === null
      && legacyKeys[entry.table].every((k) => r[k] === entry.key[k]));
    if (found.length > 1) blockers.push({ reason: "ambiguous_legacy_identity" });
    selection[entry.table].push(...found);
  }
  // Explicit null-era entities never adopt a workspace. Remove exact legacy
  // links/captures, retaining task-owned records and every unrelated task.
  for (const entity of selection["app.entities"]) {
    const own = (r) => r.workspace_id === null && r.owner_id === entity.owner_id;
    for (const table of ["app.tasks", "app.entity_tags", "app.entity_relation_links"]) {
      const related = rows(inventory, table).filter((r) => own(r) && (r.entity_id === entity.id
        || r.left_entity_id === entity.id || r.right_entity_id === entity.id || capturesEntity(r, new Set([entity.id]))));
      for (const row of related) if (!selection[table].includes(row)) selection[table].push(row);
    }
    for (const row of rows(inventory, "app.records").filter((r) => own(r) && r.task_id == null
      && (r.entity_id === entity.id || r.change_metadata?.target_kind === "entity" && r.change_metadata?.target_id === entity.id))) {
      if (!selection["app.records"].includes(row)) selection["app.records"].push(row);
    }
  }
  const legacyEntities = selection["app.entities"].filter((r) => r.workspace_id === null);
  const legacyRecords = selection["app.records"].filter((r) => r.workspace_id === null);
  for (const row of rows(inventory, "app.record_tags")) if (row.workspace_id === null && legacyRecords.some((r) => r.owner_id === row.owner_id && r.id === row.record_id)) selection["app.record_tags"].push(row);
  const legacySource = (owner, kind, id) => (kind === "entity" ? legacyEntities : kind === "record" ? legacyRecords : []).some((r) => r.owner_id === owner && r.id === id);
  for (const table of ["app.search_index_state", "app.search_chunks", "private.passage_effects"]) selection[table].push(...rows(inventory, table).filter((r) => r.workspace_id === null && legacySource(r.owner_id, r.source_kind ?? r.kind, r.source_id ?? r.id)));
  for (const table of queues) selection[table].push(...rows(inventory, table).filter((r) => r.message?.workspace_id == null && legacySource(r.message?.owner_id, r.message?.kind, r.message?.id)));
  selection["private.request_results"] = rows(inventory, "private.request_results").filter((r) => (r.result !== null || !r.completed_at)
    && legacyEntities.some((e) => e.owner_id === r.owner_id && (entityOperation(r.operation) || hasEntityReference(r.result, new Set([e.id]))
      || /^(record\.|tag\.)/.test(r.operation) && legacyRecords.some((record) => record.owner_id === e.owner_id && record.id === r.result?.id))));
  for (const row of selection["private.request_results"]) if (!row.completed_at) blockers.push({ reason: "unresolved_legacy_request", request_key: row.request_key });
  const scopes = new Map(manifest.scopes.map((s) => [s.workspace_id, s]));
  for (const scope of manifest.scopes) {
    const w = scope.workspace_id, ids = new Set(scope.entity_ids);
    const scoped = (t) => rows(inventory, t).filter((r) => r.workspace_id === w);
    const entities = scoped("app.entities");
    // Empty is permitted only for retry. Other target-set differences block apply.
    if (entities.length && (entities.length !== ids.size || entities.some((r) => !ids.has(r.id)))) blockers.push({ reason: "entity_set_changed", workspace_id: w });
    if (!rows(inventory, "app.workspaces").some((r) => r.id === w)) blockers.push({ reason: "workspace_missing", workspace_id: w });
    const typeIds = new Set(entities.filter((r) => ids.has(r.id)).map((r) => r.entity_type_id));
    const records = scoped("app.records").filter((r) => ids.has(r.entity_id));
    const recordIds = new Set(records.map((r) => r.id));
    for (const task of scoped("app.tasks")) if (recordIds.has(task.result_record_id)) blockers.push({ reason: "task_result_anchor", id: task.id });
    const refs = new Set([...ids, ...recordIds]);
    selection["app.entities"].push(...entities.filter((r) => ids.has(r.id)));
    selection["app.records"].push(...records);
    selection["app.tasks"].push(...scoped("app.tasks").filter((r) => capturesEntity(r, ids)));
    selection["app.entity_tags"].push(...scoped("app.entity_tags").filter((r) => ids.has(r.entity_id)));
    selection["app.record_tags"].push(...scoped("app.record_tags").filter((r) => recordIds.has(r.record_id)));
    selection["app.entity_relation_links"].push(...scoped("app.entity_relation_links").filter((r) => ids.has(r.left_entity_id) || ids.has(r.right_entity_id)));
    // A whole-model plan may include multiple kinds: dispose the whole plan and
    // every associated preparation, never partially truncate a conversion.
    const changes = scoped("app.entity_schema_changes"), jobs = scoped("app.entity_schema_migrations"), analyses = scoped("app.entity_schema_analyses");
    const models = scoped("app.data_model_changes");
    const children = scoped("app.data_model_children");
    const explicitRowJobs = new Set(scoped("private.entity_schema_migration_rows").filter((row) => ids.has(row.entity_id)).map((row) => row.job_id));
    const explicitRowAnalyses = new Set(scoped("private.entity_schema_analysis_rows").filter((row) => ids.has(row.entity_id)).map((row) => row.analysis_id));
    const modelIds = new Set(models.filter((r) => (r.plan?.target?.entity_types ?? []).some((type) => typeIds.has(type.schema?.["x-type-id"])
      && (r.plan?.review?.items ?? []).some((item) => item.ref === type.ref && item.kind !== "unchanged"))
      || (r.plan?.protected_kind_ids ?? []).some((id) => typeIds.has(id))
      || Object.keys(r.source_memberships ?? {}).some((id) => typeIds.has(id))
      || children.some((child) => child.model_id === r.id && typeIds.has(child.type_id))).map((r) => r.id));
    const direct = (r) => typeIds.has(r.type_id) || preparationReferences(r, ids);
    const changeIds = new Set(changes.filter(direct).map((r) => r.id));
    const jobIds = new Set([...explicitRowJobs, ...jobs.filter(direct).map((r) => r.id)]);
    const analysisIds = new Set([...explicitRowAnalyses, ...analyses.filter(direct).map((r) => r.id)]);
    const add = (set, id) => { if (id != null) set.add(id); };
    // Follow actual parent/child and retry links to a fixed point. Never infer
    // affiliation from schema literals or a full model's source document.
    let size;
    do {
      size = modelIds.size + changeIds.size + jobIds.size + analysisIds.size;
      for (const row of jobs) if (jobIds.has(row.id) || modelIds.has(row.model_change_id) || changeIds.has(row.change_id) || analysisIds.has(row.analysis_id) || jobIds.has(row.retry_source_job_id)) {
        add(jobIds, row.id); add(changeIds, row.change_id); add(analysisIds, row.analysis_id); add(modelIds, row.model_change_id);
      }
      for (const row of changes) if (changeIds.has(row.id) || modelIds.has(row.model_change_id) || analysisIds.has(row.analysis_id) || jobIds.has(row.recovery_source_job_id)) {
        add(changeIds, row.id); add(analysisIds, row.analysis_id); add(modelIds, row.model_change_id);
      }
      for (const row of analyses) if (analysisIds.has(row.id) || changeIds.has(row.change_id)) { add(analysisIds, row.id); add(changeIds, row.change_id); }
      for (const row of children) if (modelIds.has(row.model_id) || changeIds.has(row.change_id) || jobIds.has(row.job_id) || analysisIds.has(row.analysis_id)) {
        add(modelIds, row.model_id); add(changeIds, row.change_id); add(jobIds, row.job_id); add(analysisIds, row.analysis_id);
      }
    } while (size !== modelIds.size + changeIds.size + jobIds.size + analysisIds.size);
    const selectedChanges = changes.filter((r) => changeIds.has(r.id)), selectedJobs = jobs.filter((r) => jobIds.has(r.id));
    const selectedAnalyses = analyses.filter((r) => analysisIds.has(r.id));
    selection["app.data_model_changes"].push(...models.filter((r) => modelIds.has(r.id)));
    selection["app.data_model_children"].push(...scoped("app.data_model_children").filter((r) => modelIds.has(r.model_id)));
    selection["app.entity_schema_changes"].push(...selectedChanges);
    selection["app.entity_schema_migrations"].push(...selectedJobs);
    const lockedTypes = new Set(selectedJobs.map((r) => r.type_id));
    selection["app.entity_types"].push(...scoped("app.entity_types").filter((r) => r.schema_write_locked && lockedTypes.has(r.id)));
    selection["app.entity_schema_analyses"].push(...selectedAnalyses);
    selection["private.entity_schema_analysis_rows"].push(...scoped("private.entity_schema_analysis_rows").filter((r) => analysisIds.has(r.analysis_id) || ids.has(r.entity_id)));
    selection["private.entity_schema_migration_rows"].push(...scoped("private.entity_schema_migration_rows").filter((r) => jobIds.has(r.job_id) || ids.has(r.entity_id)));
    for (const t of ["app.search_index_state", "app.search_chunks", "private.passage_effects"]) {
      selection[t].push(...scoped(t).filter((r) => (r.source_kind ?? r.kind) === "entity" ? ids.has(r.source_id ?? r.id)
        : (r.source_kind ?? r.kind) === "record" && recordIds.has(r.source_id ?? r.id)));
    }
    for (const q of queues) selection[q].push(...rows(inventory, q).filter((r) => r.message?.workspace_id === w
      && (r.message.kind === "entity" ? ids.has(r.message.id) : r.message.kind === "record" && recordIds.has(r.message.id))));
    const receiptRefs = new Set([...refs, ...modelIds, ...jobIds, ...changeIds, ...analysisIds]);
    selection["private.workspace_request_results"].push(...scoped("private.workspace_request_results").filter((r) => (r.result !== null || !r.completed_at)
      && (entityOperation(r.operation) || hasEntityReference(r.result, ids)
        || /^data-model\./.test(r.operation) && modelIds.has(r.result?.id)
        || /^entity-schema-/.test(r.operation) && [r.result?.id, r.result?.job_id, r.result?.change_id, r.result?.analysis_id].some((id) => receiptRefs.has(id))
        || /^(record\.|tag\.)/.test(r.operation) && [r.result?.id, r.result?.record?.id, r.result?.target_id].some((id) => recordIds.has(id)))));
  }
  for (const row of selection["private.passage_effects"]) if (!["succeeded", "failed"].includes(row.state)) blockers.push({ reason: "unresolved_effect", id: row.id });
  for (const row of selection["private.workspace_request_results"]) if (!row.completed_at) blockers.push({ reason: "unresolved_request", request_key: row.request_key });
  // Unassigned legacy definitions/data are NEVER adopted from attribution.
  // They require a separate exact disposition before #551's NOT NULL cutover.
  const legacy = Object.fromEntries(["app.entities", ...legacyPreconditionTables].map((t) => [t, rows(inventory, t).filter((r) => r.workspace_id === null).length]));
  for (const table of ["app.entities", ...legacyPreconditionTables]) {
    const unapproved = rows(inventory, table).filter((r) => r.workspace_id === null && !selection[table].includes(r));
    if (unapproved.length) blockers.push({ reason: "legacy_disposition_required", table, count: unapproved.length });
  }
  // Retain task-owned historical records; clear only selected old captures.
  selection["legacy_record_captures"] = rows(inventory, "app.records").filter((row) => row.workspace_id === null && !selection["app.records"].includes(row)
    && legacyEntities.some((e) => row.owner_id === e.owner_id && capturesEntity(row, new Set([e.id]))));
  for (const t of Object.keys(selection)) selection[t].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const preserved = Object.fromEntries(["__store", "__catalog", ...preservedTables].map((t) => [t, [...rows(inventory, t)].sort((a, b) => canonical(a).localeCompare(canonical(b)))]));
  // Include all scoped data, not just victims: removal of a record must never
  // invalidate an unrelated task's result anchor or a new FK added unnoticed.
  const snapshot = Object.fromEntries(Object.entries(inventory).map(([t, rs]) => [t, rs.filter((r) => t.startsWith("pgmq.")
    ? scopes.has(r.message?.workspace_id) : t === "app.workspaces" ? scopes.has(r.id) : scopes.has(r.workspace_id)).sort((a, b) => canonical(a).localeCompare(canonical(b)))]));
  const report = { run_id: manifest.run_id, source_revision: manifest.source_revision, target_digest: hash(manifest), blockers,
    counts: Object.fromEntries(Object.entries(selection).map(([t, rs]) => [t, rs.length])),
    legacy_preconditions: legacy, store_digest: hash([rows(inventory, "__store"), rows(inventory, "__catalog")]), preservation_digest: hash(preserved), digest: hash({ manifest, selection, snapshot, preserved }) };
  Object.defineProperty(report, "selection", { value: selection });
  return report;
}

function connectionMatches(sql, environment) {
  const o = sql.options ?? {};
  if (o.host?.length !== 1 || o.host[0] !== environment.host || o.port?.length !== 1 || o.port[0] !== environment.port || o.database !== environment.database) {
    throw new Error("reset connection does not match explicit manifest store");
  }
}
async function inventoryFor(tx) {
  const [store] = await tx`select (pg_control_system()).system_identifier::text as system_id,
    (select oid::text from pg_database where datname=current_database()) as database_id`;
  const constraints = await tx`select c.conrelid::regclass::text as table_name,c.conname,pg_get_constraintdef(c.oid) as definition
    from pg_constraint c where c.connamespace in ('app'::regnamespace,'private'::regnamespace) order by 1,2`;
  const inventory = { "__store": [store], "__catalog": constraints };
  // Administrative maintenance, fixed allowlist; no credential/body output.
  for (const table of [...entityResetTables, ...queues, ...preservedTables, "private.request_results"]) inventory[table] = await tx`select * from ${tx(table)}`;
  return inventory;
}

/** Read-only planning or exact approved transaction. No workspace/account delete. */
export async function runEntityReset(sql, manifest, approval) {
  validateEntityResetManifest(manifest);
  connectionMatches(sql, manifest.environment);
  if (approval && (approval.target_digest !== hash(manifest) || !/^[a-f0-9]{64}$/.test(approval.digest ?? ""))) throw new Error("matching reset approval required");
  return await sql.begin(async (tx) => {
    if (!approval) await tx`set transaction isolation level repeatable read, read only`;
    await tx`set local lock_timeout='5s'`;
    await tx`set local statement_timeout='30s'`;
    if (approval) {
      // Block every actual source/worker/receipt writer before taking a fresh
      // snapshot. Maintenance must already have stopped worker/provider calls.
      for (const table of [...entityResetTables, ...queues, ...preservedTables, "private.request_results"].sort()) {
        await tx`lock table ${tx(table)} in share row exclusive mode`;
      }
    }
    const before = await inventoryFor(tx), report = planEntityReset(manifest, before);
    if (!approval) return { mode: "plan", ...report };
    if (report.store_digest !== approval.store_digest) throw new Error("reset database identity or constraints changed");
    const remaining = Object.values(report.counts).some((n) => n);
    if (!remaining && !report.blockers.length) return { mode: "already-clean", ...report, residual_rows: 0 };
    if (report.digest !== approval.digest) throw new Error("reset plan changed; repeat read-only planning");
    if (report.blockers.length) throw new Error("reset blocked by unresolved work or changed target");
    const selection = report.selection;
    const selectMutationContext = async (workspaceId) => {
      const scope = workspaceId == null ? null : manifest.scopes.find((scope) => scope.workspace_id === workspaceId);
      if (workspaceId != null && !scope) throw new Error("mutation outside approved workspace scopes");
      // NULL-era teardown uses the existing privileged parent-cleanup path.
      // Current rows always retain their own manifest actor and live guards.
      await tx`select set_config('request.jwt.claims',${JSON.stringify(scope ? { sub: scope.actor_id, role: "authenticated" } : {})},true),
        set_config('request.workspace_id',${scope?.workspace_id ?? ""},true),set_config('request.workspace_lock_mode',${scope ? "business" : ""},true),
        set_config('request.workspace_requirements','[]',true)`;
    };
    await selectMutationContext(null);
    for (const row of selection["private.request_results"]) await tx`update private.request_results set result=null where owner_id=${row.owner_id} and request_key=${row.request_key} and completed_at is not null`;
    for (const row of selection["app.tasks"].filter((r) => r.workspace_id === null)) {
      const ids = new Set(selection["app.entities"].filter((e) => e.workspace_id === null && e.owner_id === row.owner_id).map((e) => e.id));
      await tx`update app.tasks set entity_ids=${(row.entity_ids ?? []).filter((id) => !ids.has(id))}::text[],entity_context=${tx.json((row.entity_context ?? []).filter((r) => !ids.has(r.id)))},version=version+1,updated_at=clock_timestamp() where workspace_id is null and owner_id=${row.owner_id} and id=${row.id}`;
    }
    // Receipts are invalidated, NEVER deleted: the same old key stays expired.
    for (const row of selection["private.workspace_request_results"]) await tx`update private.workspace_request_results set result=null
      where executor_id=${row.executor_id} and workspace_id=${row.workspace_id} and request_key=${row.request_key} and completed_at is not null`;
    for (const row of selection["legacy_record_captures"]) {
      const ids = new Set(selection["app.entities"].filter((e) => e.workspace_id === null && e.owner_id === row.owner_id).map((e) => e.id));
      await tx`update app.records set entity_ids=${(row.entity_ids ?? []).filter((id) => !ids.has(id))}::text[],entity_context=${tx.json((row.entity_context ?? []).filter((r) => !ids.has(r.id)))} where workspace_id is null and owner_id=${row.owner_id} and id=${row.id}`;
    }
    for (const scope of manifest.scopes) {
      await selectMutationContext(scope.workspace_id);
      const ids = new Set(scope.entity_ids);
      for (const row of selection["app.tasks"].filter((r) => r.workspace_id === scope.workspace_id)) {
        const entityIds = (row.entity_ids ?? []).filter((id) => !ids.has(id));
        const context = (row.entity_context ?? []).filter((item) => !ids.has(item.id));
        await tx`update app.tasks set entity_ids=${entityIds}::text[],entity_context=${tx.json(context)},version=version+1,updated_at=clock_timestamp()
          where workspace_id=${scope.workspace_id} and id=${row.id}`;
      }
    }
    const deleteRows = async (table, key) => {
      for (const row of selection[table]) {
        await selectMutationContext(row.workspace_id ?? row.message?.workspace_id ?? null);
        const exactKeys = row.workspace_id === null && row.owner_id && !key.includes("owner_id") ? [...key, "owner_id"] : key;
        const predicates = exactKeys.map((k) => tx`${tx(k)} is not distinct from ${row[k]}`);
        const where = predicates.reduce((a, b) => tx`${a} and ${b}`);
        await tx`delete from ${tx(table)} where ${where}`;
      }
    };
    // Child references before parents; jobs/changes contain cyclic analysis links.
    await deleteRows("app.data_model_children", ["workspace_id", "model_id", "type_ref"]);
    await deleteRows("private.entity_schema_migration_rows", ["workspace_id", "job_id", "entity_id"]);
    await deleteRows("private.entity_schema_analysis_rows", ["workspace_id", "analysis_id", "entity_id"]);
    // Self retry FK is checked at end of each statement, so delete same-scope
    // lineage together rather than row by row. All type jobs are selected.
    const legacyOwners = [...new Set(selection["app.entity_schema_migrations"].filter((r) => r.workspace_id === null).map((r) => r.owner_id))];
    await selectMutationContext(null);
    for (const owner of legacyOwners) {
      const ids = selection["app.entity_schema_migrations"].filter((r) => r.workspace_id === null && r.owner_id === owner).map((r) => r.id);
      await tx`delete from app.entity_schema_migrations where workspace_id is null and owner_id=${owner} and id=any(${ids}::uuid[])`;
    }
    for (const row of selection["app.entity_schema_changes"].filter((r) => r.workspace_id === null)) await tx`update app.entity_schema_changes set analysis_id=null where workspace_id is null and owner_id=${row.owner_id} and id=${row.id}`;
    for (const scope of manifest.scopes) {
      await selectMutationContext(scope.workspace_id);
      const ids = selection["app.entity_schema_migrations"].filter((r) => r.workspace_id === scope.workspace_id).map((r) => r.id);
      if (ids.length) await tx`delete from app.entity_schema_migrations where workspace_id=${scope.workspace_id} and id=any(${ids}::uuid[])`;
      const changes = selection["app.entity_schema_changes"].filter((r) => r.workspace_id === scope.workspace_id).map((r) => r.id);
      // change.analysis_id may point back to its analysis. Clear only this
      // transient reviewed pointer; never change a published definition.
      if (changes.length) await tx`update app.entity_schema_changes set analysis_id=null where workspace_id=${scope.workspace_id} and id=any(${changes}::uuid[])`;
    }
    await deleteRows("app.entity_schema_analyses", ["workspace_id", "id"]);
    await deleteRows("app.entity_schema_changes", ["workspace_id", "id"]);
    await deleteRows("app.data_model_changes", ["workspace_id", "id"]);
    for (const row of selection["app.entity_types"].filter((r) => r.workspace_id !== null)) {
      await selectMutationContext(row.workspace_id);
      await tx`update app.entity_types set schema_write_locked=false where workspace_id=${row.workspace_id} and id=${row.id}`;
    }
    for (const table of queues) await deleteRows(table, ["msg_id"]);
    await deleteRows("private.passage_effects", ["id"]);
    await deleteRows("app.search_chunks", ["workspace_id", "source_kind", "source_id", "ordinal"]);
    await deleteRows("app.search_index_state", ["workspace_id", "kind", "id"]);
    await deleteRows("app.entity_relation_links", ["workspace_id", "definition_id", "left_entity_id", "right_entity_id"]);
    await deleteRows("app.entity_tags", ["workspace_id", "entity_id", "tag_id"]);
    await deleteRows("app.record_tags", ["workspace_id", "record_id", "tag_id"]);
    await deleteRows("app.records", ["workspace_id", "id"]);
    await deleteRows("app.entities", ["workspace_id", "id"]);
    // These definition rows can enter selection ONLY through explicit null-era
    // dispositions, never through a workspace or author wildcard.
    for (const table of ["app.entity_type_identity_sources", "app.entity_type_identity", "app.entity_schema_versions",
      "app.entity_relation_definitions", "app.entity_identifier_rules", "app.entity_issuers", "app.entity_types"]) {
      if (selection[table].some((r) => r.workspace_id !== null)) {
        if (table !== "app.entity_types") throw new Error("scoped definition deletion forbidden");
      }
      const scoped = selection[table];
      selection[table] = scoped.filter((r) => r.workspace_id === null);
      await deleteRows(table, ["workspace_id", ...legacyKeys[table]]);
      selection[table] = scoped;
    }
    const after = await inventoryFor(tx), residual = planEntityReset(manifest, after);
    if (Object.values(residual.counts).some((n) => n) || report.preservation_digest !== residual.preservation_digest) throw new Error("reset residual references or preservation mismatch");
    return { mode: "applied", ...report, residual_rows: 0 };
  });
}
