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
