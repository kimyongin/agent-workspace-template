import test from "node:test";
import assert from "node:assert/strict";
const type = "11111111-1111-4111-8111-111111111111";
const baseline = "22222222-2222-4222-8222-222222222222";

test("whole-model introduced roots exclude updated baseline types and system issuers", async () => {
  const { modelFixtureRoots } = await import("./workspace-model-fixture.mjs");
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
