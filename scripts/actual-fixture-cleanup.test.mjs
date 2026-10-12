import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupOwnedFixture,
  fixtureManifest,
} from "./actual-fixture-cleanup.mjs";
const type = "00000000-0000-4000-8000-000000000001",
  baseline = "00000000-0000-4000-8000-000000000002";
const scope = {
  ownerId: type,
  ids: {
    entities: [],
    tasks: ["created-task"],
    records: [],
    tags: [],
    entity_types: [type],
  },
  requestKeys: [],
};
const environment = {
  name: "owned-test",
  host: "127.0.0.1",
  port: 57922,
  database: "postgres",
};
test("fixture closure uses exact introduced types and structured references while preserving baseline, other owners and unrelated settings", () => {
  const plan = fixtureManifest("owner", scope, {
    entity_types: [{ owner_id: "owner", id: type }, {
      owner_id: "owner",
      id: baseline,
    }],
    entities: [{ owner_id: "owner", id: "entity", entity_type_id: type }, {
      owner_id: "owner",
      id: "keep",
      entity_type_id: baseline,
    }, { owner_id: "other", id: "other", entity_type_id: type }],
    tasks: [{ owner_id: "owner", id: "created-task" }, {
      owner_id: "owner",
      id: "linked",
      entity_ids: ["entity"],
    }, { owner_id: "owner", id: "keep-task", title: type }],
    records: [
      {
        owner_id: "owner",
        id: "historical",
        change_metadata: { before: { entity_type_id: type } },
      },
      {
        owner_id: "owner",
        id: "task-history",
        change_metadata: { target_kind: "task", target_id: "created-task" },
      },
      { owner_id: "owner", id: "followup", task_id: "linked" },
      {
        owner_id: "owner",
        id: "keep-record",
        body: type,
        change_metadata: { before: { properties: { prop_1: type } } },
      },
      { owner_id: "other", id: "other-record", entity_ids: ["entity"] },
    ],
    tags: [],
    settings: [{
      owner_id: "owner",
      id: "record_templates",
      settings: {
        entity_types: {
          [type]: { update: { memo: "owned" } },
          [baseline]: { update: { memo: "keep" } },
        },
        task: { create: { memo: "keep" } },
      },
    }],
  }, environment);
  assert.deepEqual(plan.ids, {
    entities: ["entity"],
    tasks: ["created-task", "linked"],
    records: ["followup", "historical", "task-history"],
    tags: [],
    entity_types: [type],
  });
  assert.deepEqual(plan.reset_template_paths, [[
    "entity_types",
    type,
    "update",
  ]]);
});
test("cleanup rejects remote/mismatched environment before connecting and permits an empty failed-setup scope", async () => {
  await assert.rejects(
    () =>
      cleanupOwnedFixture(
        "postgres://x:secret@remote.invalid:57922/postgres",
        environment,
        scope,
      ),
    /loopback/,
  );
  await assert.rejects(
    () =>
      cleanupOwnedFixture(
        "postgres://x:secret@127.0.0.1:55422/postgres",
        environment,
        scope,
      ),
    /does not match/,
  );
  assert.deepEqual(
    await cleanupOwnedFixture("not a database", environment, {
      ownerId: type,
      ids: { entities: [], tasks: [], records: [], tags: [], entity_types: [] },
      requestKeys: [],
    }),
    [],
  );
});
