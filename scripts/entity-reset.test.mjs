import test from "node:test";
import assert from "node:assert/strict";
import { planEntityReset, validateEntityResetManifest } from "./entity-reset.mjs";
const workspace = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const type = "00000000-0000-4000-8000-000000000003";
const manifest = { run_id: "reset551", project_id: "isolated", source_revision: "a".repeat(40),
  environment: { host: "127.0.0.1", port: 62522, database: "postgres" },
  scopes: [{ workspace_id: workspace, actor_id: actor, entity_ids: ["exact"] }] };
const inventory = { "app.entities": [{ workspace_id: workspace, id: "exact", entity_type_id: type }],
  "app.workspaces": [{ id: workspace }],
  "app.tasks": [{ workspace_id: workspace, id: "linked", entity_ids: ["exact"], entity_context: [{ id: "exact" }] },
    { workspace_id: workspace, id: "unrelated", entity_ids: [], entity_context: [] }],
  "app.records": [{ workspace_id: workspace, id: "owned", entity_id: "exact" },
    { workspace_id: workspace, id: "task-record", task_id: "linked", entity_id: null }],
  "private.workspace_request_results": [{ workspace_id: workspace, request_key: "receipt", operation: "entity.create", completed_at: "done", result: { id: "exact" } },
    { workspace_id: workspace, request_key: "task", operation: "task.create", completed_at: "done", result: { id: "unrelated" } }],
  "pgmq.q_search_index": [{ msg_id: "1", message: { workspace_id: workspace, kind: "entity", id: "exact" } },
    { msg_id: "2", message: { workspace_id: workspace, kind: "record", id: "task-record" } }],
};
test("entity reset preserves workspace, unrelated tasks and task-owned records and receipts", () => {
  const plan = planEntityReset(manifest, inventory);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts["app.entities"], 1);
  assert.equal(plan.counts["app.tasks"], 1);
  assert.equal(plan.counts["app.records"], 1);
  assert.equal(plan.counts["private.workspace_request_results"], 1);
  assert.equal(plan.counts["pgmq.q_search_index"], 1);
  assert.ok(!JSON.stringify(plan).includes("task-record"));
});
test("exact scope fences new entity, changed linked content and unresolved effects", () => {
  const changed = structuredClone(inventory);
  changed["app.entities"].push({ workspace_id: workspace, id: "new", entity_type_id: type });
  assert.ok(planEntityReset(manifest, changed).blockers.some((b) => b.reason === "entity_set_changed"));
  changed["private.passage_effects"] = [{ workspace_id: workspace, id: "effect", source_kind: "entity", source_id: "exact", state: "unknown" }];
  assert.ok(planEntityReset(manifest, changed).blockers.some((b) => b.reason === "unresolved_effect"));
  const content = structuredClone(inventory); content["app.tasks"][0].title = "changed";
  assert.notEqual(planEntityReset(manifest, inventory).digest, planEntityReset(manifest, content).digest);
});
test("scope and store must be explicit and canonical; no arbitrary SQL/table manifest", () => {
  for (const key of ["run_id", "source_revision", "project_id", "environment", "scopes"]) {
    const bad = { ...manifest }; delete bad[key]; assert.throws(() => validateEntityResetManifest(bad));
  }
  assert.throws(() => validateEntityResetManifest({ ...manifest, environment: { ...manifest.environment, host: "remote" } }), /loopback/);
  assert.throws(() => validateEntityResetManifest({ ...manifest, scopes: [{ ...manifest.scopes[0], entity_ids: ["exact", "exact"] }] }));
});
test("NULL legacy definitions require exact dispositions, never owner-to-workspace adoption", () => {
  const legacy = { ...inventory, "app.entity_types": [{ workspace_id: null, owner_id: actor, id: type, schema_version: 1 }] };
  assert.ok(planEntityReset(manifest, legacy).blockers.some((b) => b.reason === "legacy_disposition_required"));
  const approved = { ...manifest, legacy_rows: [{ table: "app.entity_types", key: { owner_id: actor, id: type } }] };
  assert.deepEqual(planEntityReset(approved, legacy).blockers, []);
  assert.equal(planEntityReset(approved, legacy).counts["app.entity_types"], 1);
  assert.throws(() => validateEntityResetManifest({ ...manifest, legacy_rows: [{ table: "auth.users", key: { id: actor } }] }), /allowlisted/);
});
test("pending entity writes block reset even without a successful result", () => {
  const pending = structuredClone(inventory);
  pending["private.workspace_request_results"].push({ workspace_id: workspace, operation: "entity.create", request_key: "pending", result: null, completed_at: null });
  assert.ok(planEntityReset(manifest, pending).blockers.some((b) => b.reason === "unresolved_request"));
});
test("duplicate full legacy identity and arbitrary manifest keys are rejected", () => {
  const entry = { table: "app.entity_types", key: { owner_id: actor, id: type } };
  assert.throws(() => validateEntityResetManifest({ ...manifest, legacy_rows: [entry, entry] }), /duplicate/);
});
test("legacy entity change records are owned by captured change metadata; task results retain their bodies", () => {
  const legacyEntity = { workspace_id: null, owner_id: actor, id: "legacy", entity_type_id: type };
  const data = { ...inventory, "app.entities": [...inventory["app.entities"], legacyEntity], "app.records": [
    { workspace_id: null, owner_id: actor, id: "entity-history", task_id: null, change_metadata: { target_kind: "entity", target_id: "legacy" } },
    { workspace_id: null, owner_id: actor, id: "task-history", task_id: "task", body: "keep", entity_ids: ["legacy"], entity_context: [{ id: "legacy" }] },
  ] };
  const plan = planEntityReset({ ...manifest, legacy_rows: [{ table: "app.entities", key: { owner_id: actor, id: "legacy" } }] }, data);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts["app.records"], 1);
  assert.equal(plan.counts.legacy_record_captures, 1);
});
test("literal collisions never select unrelated drafts, models or task receipts; typed job references retain lineage", () => {
  const otherType = "00000000-0000-4000-8000-000000000009";
  const data = { ...inventory,
    "app.entity_schema_changes": [{ workspace_id: workspace, id: "unrelated", type_id: otherType, target: { schema: { properties: { prop_1: { title: "exact", default: type } } } } },
      { workspace_id: workspace, id: "parent", type_id: otherType, analysis_id: "analysis" }],
    "app.entity_schema_migrations": [{ workspace_id: workspace, id: "job", type_id: otherType, change_id: "parent", analysis_id: "analysis", source_references: { typed_links: [["definition", "exact", "peer", "date", 1]] } }],
    "app.entity_schema_analyses": [{ workspace_id: workspace, id: "analysis", type_id: otherType, change_id: "parent" }],
    "app.data_model_changes": [{ workspace_id: workspace, id: "unrelated-model", plan: { source: { entity_types: [{ schema: { "x-type-id": type } }] }, target: { entity_types: [{ schema: { "x-type-id": otherType, description: "exact" } }] } } }],
    "private.workspace_request_results": [...inventory["private.workspace_request_results"], { workspace_id: workspace, operation: "task.create", request_key: "ordinary-value", completed_at: "done", result: { id: "task", title: "exact", body: "exact", entity_ids: [], entity_context: [] } }],
  };
  const plan = planEntityReset(manifest, data);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts["app.entity_schema_changes"], 1);
  assert.equal(plan.counts["app.entity_schema_migrations"], 1);
  assert.equal(plan.counts["app.entity_schema_analyses"], 1);
  assert.equal(plan.counts["app.data_model_changes"], 0);
  assert.equal(plan.counts["private.workspace_request_results"], 1);
});

test("explicit incompatible definition retirement selects exact versions, endpoints and live contract receipts", () => {
  const compatible = "00000000-0000-4000-8000-000000000004";
  const data = structuredClone(inventory);
  data["app.entity_types"] = [{ workspace_id: workspace, id: type, schema_version: 2 }, { workspace_id: workspace, id: compatible, schema_version: 1 }];
  data["app.entity_schema_versions"] = [1, 2].map((schema_version) => ({ workspace_id: workspace, type_id: type, schema_version, schema: { properties: {} } }));
  data["app.entity_schema_versions"].push({ workspace_id: workspace, type_id: compatible, schema_version: 1, schema: { "x-identity-property": "key", required: ["key"], properties: { key: { type: "string", "x-identifier": {} } } } });
  data["app.entity_relation_definitions"] = [{ workspace_id: workspace, id: "endpoint", left_type_id: type, right_type_id: compatible }, { workspace_id: workspace, id: "keep", left_type_id: compatible, right_type_id: compatible }];
  data["private.workspace_request_results"].push({ workspace_id: workspace, request_key: "type", operation: "entity-type.create", completed_at: "done", result: { id: type } });
  assert.ok(planEntityReset(manifest, data).blockers.some((b) => b.reason === "incompatible_definition_disposition_required"));
  const m = structuredClone(manifest); m.scopes[0].retire_definitions = [{ type_id: type, expected_schema_version: 2, schema_versions: [1, 2] }];
  const plan = planEntityReset(m, data);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts["app.entity_types"], 1);
  assert.equal(plan.counts["app.entity_schema_versions"], 2);
  assert.equal(plan.counts["app.entity_relation_definitions"], 1);
  assert.equal(plan.counts["private.workspace_request_results"], 2);
  for (const mutate of [
    (d) => d["app.entity_types"][0].schema_version++,
    (d) => d["app.entity_schema_versions"].push({ workspace_id: workspace, type_id: type, schema_version: 3, schema: {} }),
    (d) => { d["app.entity_relation_definitions"][0].right_type_id = type; },
    (d) => d["private.workspace_request_results"].push({ workspace_id: workspace, request_key: "race", operation: "entity-type.update", completed_at: null, result: null }),
    (d) => { d.__catalog = [{ definition: "changed guard" }]; },
  ]) { const changed = structuredClone(data); mutate(changed); assert.notEqual(planEntityReset(m, changed).digest, plan.digest); }
  const protectedData = structuredClone(data);
  protectedData["private.workspace_grants"] = [{ workspace_id: workspace, entity_type_id: type }];
  assert.ok(planEntityReset(m, protectedData).blockers.some((b) => b.reason === "definition_has_preserved_grants"));
  const unsafe = structuredClone(m); unsafe.scopes[0].retire_definitions = [{ type_id: compatible, expected_schema_version: 1, schema_versions: [1] }];
  assert.ok(planEntityReset(unsafe, data).blockers.some((b) => b.reason === "compatible_definition_retirement_forbidden"));
});

test("approved NULL-era registry victims alone are excluded from preservation while scoped lookalikes remain fenced", () => {
  const legacyIssuer = { workspace_id: null, owner_id: actor, code: "legacy", label: "retire" };
  const legacyRule = { workspace_id: null, owner_id: actor, id: type, source: "legacy", label: "retire" };
  const scopedIssuer = { ...legacyIssuer, workspace_id: workspace, label: "preserve issuer" };
  const scopedRule = { ...legacyRule, workspace_id: workspace, label: "preserve rule" };
  const approved = { ...manifest, legacy_rows: [
    { table: "app.entity_issuers", key: { owner_id: actor, code: "legacy" } },
    { table: "app.entity_identifier_rules", key: { owner_id: actor, id: type } },
  ] };
  const before = { ...inventory, "app.entity_issuers": [legacyIssuer, scopedIssuer], "app.entity_identifier_rules": [legacyRule, scopedRule] };
  const after = { ...inventory, "app.entity_issuers": [scopedIssuer], "app.entity_identifier_rules": [scopedRule] };
  const plan = planEntityReset(approved, before);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.counts["app.entity_issuers"], 1);
  assert.equal(plan.counts["app.entity_identifier_rules"], 1);
  assert.equal(plan.preservation_digest, planEntityReset(approved, after).preservation_digest);
  for (const table of ["app.entity_issuers", "app.entity_identifier_rules"]) {
    const changed = structuredClone(after); changed[table][0].label = "concurrent change";
    assert.notEqual(plan.preservation_digest, planEntityReset(approved, changed).preservation_digest);
    const unapproved = { ...before, [table]: [...before[table], { ...before[table][0], owner_id: "00000000-0000-4000-8000-000000000099" }] };
    const mutated = structuredClone(unapproved); mutated[table][2].label = "unapproved legacy change";
    assert.notEqual(planEntityReset(approved, unapproved).preservation_digest, planEntityReset(approved, mutated).preservation_digest);
  }
});
