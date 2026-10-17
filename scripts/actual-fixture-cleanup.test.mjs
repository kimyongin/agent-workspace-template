import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupOwnedFixture,
  fixtureManifest,
  registryFixturePlan,
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

test("registry cleanup uses exact created owner/source/rule scope and blocks baseline references", () => {
  const rule = "00000000-0000-4000-8000-000000000003";
  const created = {
    ...scope,
    ids: {
      ...scope.ids,
      entity_issuers: ["market"],
      entity_identifier_rules: [rule],
    },
  };
  const inventory = {
    entity_issuers: [{ owner_id: "owner", code: "market", system: false }, {
      owner_id: "other",
      code: "market",
      system: false,
    }, { owner_id: "owner", code: "app", system: true }],
    entity_identifier_rules: [{
      owner_id: "owner",
      id: rule,
      source: "market",
    }],
    entity_type_identity_sources: [{
      owner_id: "owner",
      type_id: type,
      code: "market",
      rule_id: rule,
    }],
    entities: [{ owner_id: "owner", entity_type_id: type, source: "market" }],
  };
  assert.deepEqual(registryFixturePlan("owner", created, inventory), {
    issuers: ["market"],
    rules: [rule],
    blockers: [],
  });
  const unapproved = structuredClone(inventory);
  unapproved.entity_type_identity_sources.push({
    owner_id: "owner",
    type_id: baseline,
    code: "market",
    rule_id: rule,
  });
  assert.deepEqual(registryFixturePlan("owner", created, unapproved).blockers, [
    "unapproved_type_identity_reference",
  ]);
  unapproved.entity_identifier_rules.push({
    owner_id: "owner",
    id: baseline,
    source: "market",
  });
  assert.deepEqual(registryFixturePlan("owner", created, unapproved).blockers, [
    "untracked_issuer_rule",
    "unapproved_type_identity_reference",
  ]);
  assert.deepEqual(
    registryFixturePlan("owner", {
      ids: { entity_types: [], entity_issuers: ["app"] },
    }, inventory).blockers,
    ["system_issuer"],
  );
});

test("whole-model introduced roots exclude updated baseline types and system issuers", async () => {
  const { modelFixtureRoots } = await import("./actual-fixture-cleanup.mjs");
  assert.deepEqual(
    modelFixtureRoots({
      id: type,
      review: {
        mapping: { types: { fresh: type, existing: baseline } },
        items: [
          { ref: "fresh", kind: "new" },
          { ref: "existing", kind: "compatible" },
          { ref: `relation:${baseline}`, kind: "new" },
          { ref: "issuer:app", kind: "new" },
          { ref: "issuer:market", kind: "new" },
          { ref: `rule:${baseline}`, kind: "new" },
        ],
      },
    }),
    {
      data_model_changes: [type],
      entity_types: [type],
      entity_relation_definitions: [baseline],
      entity_issuers: ["market"],
      entity_identifier_rules: [baseline],
    },
  );
});
test("typed model scope includes only explicit definitions/history and keeps unrelated owner rows", () => {
  const plan = fixtureManifest("owner", {
    ...scope,
    ids: {
      ...scope.ids,
      entity_relation_definitions: [type],
      data_model_changes: [baseline],
    },
  }, {
    entity_types: [{ owner_id: "owner", id: type }],
    entity_relation_definitions: [{ owner_id: "owner", id: type }, {
      owner_id: "other",
      id: baseline,
    }],
    data_model_changes: [{ owner_id: "owner", id: baseline }, {
      owner_id: "owner",
      id: type,
    }],
    entities: [],
    tasks: [],
    records: [],
    tags: [],
  }, environment);
  assert.deepEqual(plan.ids.entity_relation_definitions, [type]);
  assert.deepEqual(plan.ids.data_model_changes, [baseline]);
});
