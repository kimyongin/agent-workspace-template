import test from "node:test";
import assert from "node:assert/strict";
import { planWorkspaceCleanup, runWorkspaceCleanup } from "./workspace-fixture-cleanup.mjs";

const workspace = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const manifest = {
  run_id: "owned-run",
  source_revision: "a".repeat(40),
  project_id: "owned-local-project",
  environment: { name: "owned-local", host: "127.0.0.1", port: 61922, database: "postgres" },
  workspace: { id: workspace, name: "owned-fixture", created_by: actor },
  member_ids: [actor],
  disposable_effect_ids: [],
};
const inventory = {
  "app.workspaces": [{ id: workspace, name: "owned-fixture", created_by: actor }],
  "private.workspace_members": [{ workspace_id: workspace, user_id: actor }],
  "app.entities": [{ workspace_id: workspace, id: "owned-entity", owner_id: null }, {
    workspace_id: "00000000-0000-4000-8000-000000000009", id: "shared-sentinel", owner_id: actor,
  }],
  "private.passage_effects": [{ id: "finished", workspace_id: workspace, state: "succeeded" }],
  "pgmq.q_search_index": [{ msg_id: 7, message: { workspace_id: workspace } }],
};

test("owned workspace cleanup selects nullable-attribution data and preserves another workspace", () => {
  const report = planWorkspaceCleanup(manifest, inventory);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.counts["app.entities"], 1);
  assert.equal(report.counts["private.passage_effects"], 1);
  assert.equal(report.counts["pgmq.q_search_index"], 1);
  assert.deepEqual(report.effect_ids, ["finished"]);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(report).includes("shared-sentinel"));
});

test("changed creator or unregistered member blocks workspace cascade", () => {
  const changed = structuredClone(inventory);
  changed["app.workspaces"][0].created_by = "00000000-0000-4000-8000-000000000009";
  changed["private.workspace_members"].push({ workspace_id: workspace, user_id: "00000000-0000-4000-8000-000000000008" });
  assert.deepEqual(planWorkspaceCleanup(manifest, changed).blockers.map((entry) => entry.reason), [
    "workspace_identity_changed", "unexpected_member",
  ]);
});

test("unresolved external effects block disposal unless their exact fake IDs were declared", () => {
  const changed = structuredClone(inventory);
  changed["private.passage_effects"].push({ id: "waiting-fake", workspace_id: workspace, state: "running" }, {
    id: "unknown-unowned", workspace_id: null, state: "unknown",
  });
  assert.deepEqual(planWorkspaceCleanup(manifest, changed).blockers, [{ reason: "unresolved_effect", id: "waiting-fake" }]);
  assert.deepEqual(planWorkspaceCleanup({ ...manifest, disposable_effect_ids: ["waiting-fake"] }, changed).blockers, []);
  assert.deepEqual(planWorkspaceCleanup(manifest, changed).effect_ids, ["finished", "waiting-fake"]);
});

test("missing explicit run, store or workspace identity never produces an executable plan", () => {
  for (const key of ["run_id", "source_revision", "project_id", "environment", "workspace", "member_ids", "disposable_effect_ids"]) {
    const missing = { ...manifest };
    delete missing[key];
    assert.throws(() => planWorkspaceCleanup(missing, inventory), /explicit/);
  }
  assert.throws(() => planWorkspaceCleanup({ ...manifest, environment: { ...manifest.environment, host: "example.com" } }, inventory), /loopback/);
});

test("account-scoped workspace creation receipts belong to their exact returned workspace", () => {
  const changed = { ...inventory, "private.workspace_request_results": [
    { workspace_id: null, result_workspace_id: workspace, request_key: "creation-key" },
    { workspace_id: null, result_workspace_id: "00000000-0000-4000-8000-000000000009", request_key: "unrelated-key" },
  ] };
  assert.equal(planWorkspaceCleanup(manifest, changed).counts["private.workspace_request_results"], 1);
});

test("invalid approval is rejected before opening a database transaction", async () => {
  const connection = { begin() { assert.fail("invalid approval must not open a transaction"); } };
  await assert.rejects(runWorkspaceCleanup(connection, manifest, { workspace_id: workspace, digest: "wrong", effect_ids: [] }), /approval/);
});

test("the actual connection must match the manifest store before inventory or mutation", async () => {
  const connection = {
    options: { host: ["127.0.0.1"], port: [61923], database: "postgres" },
    begin() { assert.fail("another store must not be inspected"); },
  };
  await assert.rejects(runWorkspaceCleanup(connection, manifest), /connection.*match/);
});
