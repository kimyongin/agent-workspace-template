import { assertEquals, assertRejects } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import type { RecoveryContext, RecoveryProposal } from "./recovery-policy.ts";
import { createEntitySchemaRecovery } from "./schema-migrations.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
function context(): RecoveryContext {
  const source = initialEntityDefinition("이름"), current = structuredClone(source);
  current.schema.properties.prop_4 = {
    "x-order": 40,
    type: "string",
    title: "현재만 존재",
    oneOf: ["value"].map((value) => ({ const: value })),
  };
  current.schema.properties.prop_4.deprecated = true;
  current.schema.properties.prop_4.oneOf = [{ const: "value", title: "표시 이름" }];
  return {
    job_id: jobId,
    job_version: 4,
    observed_at: "2026-10-12T00:00:00Z",
    source,
    current,
    committed_target: structuredClone(source),
    committed_membership: "membership",
    committed_references: {},
    evidence: {
      status: "succeeded",
      expires_at: "2026-11-01T00:00:00Z",
      material_present: true,
      retained: 1,
      total: 1,
      values_match: true,
      references_match: true,
      conflicts: [],
      type: { id: jobId, version: 3, schema_version: 2, archived: false, schema_write_locked: false },
    },
  };
}
function usecase(c: RecoveryContext) {
  const saved: RecoveryProposal[] = [];
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    loadRecovery: () => Promise.resolve(c),
    recoveryObservedAt: () => Promise.resolve(c.observed_at),
    recoveryTemplates: () => Promise.resolve("templates"),
    saveRecovery: (_c: RecoveryContext, proposal: RecoveryProposal) => {
      saved.push(proposal);
      return Promise.resolve(proposal);
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_actor, fn) => fn(store) } };
  return {
    saved,
    create: () =>
      createEntitySchemaRecovery(
        deps,
        { userId: "owner", source: "http", request: { key: crypto.randomUUID() } },
        jobId,
        { expected_job_version: 4, expected_schema_version: 2 },
      ),
  };
}
Deno.test("recovery creation retains current-only field values and presentation in its new proposal", async () => {
  const c = context(), run = usecase(c);
  c.current.schema.title = "변환 후 새 이름";
  c.current.schema["x-icon"] = "leaf";
  c.current.schema.description = "최신 설명";
  await run.create();
  assertEquals(run.saved.length, 1);
  assertEquals(run.saved[0].target, c.current);
  assertEquals(run.saved[0].keys, ["prop_1", "prop_2"]);
  assertEquals(c.source.schema.required, ["prop_1", "prop_2"]);
});
Deno.test("recovery creation uses the observed expiry before the active gate and never saves stale material", async () => {
  const expired = context();
  expired.evidence.expires_at = expired.observed_at;
  expired.evidence.type.schema_write_locked = true;
  const run = usecase(expired);
  const error = await assertRejects(run.create);
  assertEquals((error as { code: string }).code, "migration_source_expired");
  assertEquals(run.saved, []);
  for (const mismatch of ["values_match", "references_match"] as const) {
    const c = context();
    c.evidence[mismatch] = false;
    const stale = usecase(c), e = await assertRejects(stale.create);
    assertEquals((e as { code: string }).code, "schema_plan_stale");
    assertEquals(stale.saved, []);
  }
});

Deno.test("recovery creation observes expiry again after template preparation before saving", async () => {
  const c = context(), run = usecase(c);
  c.evidence.expires_at = "2026-11-01T00:00:00Z";
  // The locked source observation precedes the later explicit adapter clock.
  const sourceTime = c.observed_at;
  const store = {
    executeRequest: <T>(_r: unknown, fn: () => Promise<T>) => fn(),
    loadRecovery: () => Promise.resolve({ ...c, observed_at: sourceTime }),
    recoveryTemplates: () => Promise.resolve("templates"),
    recoveryObservedAt: () => Promise.resolve("2026-11-01T00:00:00Z"),
    saveRecovery: () => {
      throw new Error("expired source must never save");
    },
  } as unknown as EntityTypeStore;
  const e = await assertRejects(async () =>
    await createEntitySchemaRecovery(
      { uow: { run: (_a, fn) => fn(store) } },
      { userId: "owner", request: { key: crypto.randomUUID() } },
      jobId,
      { expected_job_version: 4, expected_schema_version: 2 },
    )
  );
  assertEquals((e as { code: string }).code, "migration_source_expired");
  assertEquals(run.saved, []);
});

Deno.test("recovery review reports each restored property type instead of a generic definition object", async () => {
  const c = context();
  c.source.schema.properties.prop_3 = { "x-order": 30, type: "integer", title: "가격" };

  c.current.schema.properties.prop_3 = { "x-order": 30, type: "string", title: "가격" };

  c.committed_target = structuredClone(c.current);
  const run = usecase(c);
  await run.create();
  assertEquals(run.saved[0].diff.find((d) => d.path === "properties.prop_3.type")?.before, "string");
  assertEquals(run.saved[0].diff.find((d) => d.path === "properties.prop_3.type")?.after, "integer");
});

Deno.test("bounded value recovery preserves the current archived root and newer metadata", async () => {
  const c = context(), run = usecase(c);
  c.evidence.type.archived = true;
  c.current.schema.title = "보관 후 이름";
  c.current.schema["x-icon"] = "book";
  c.current.schema.deprecated = true;
  await run.create();
  assertEquals(run.saved[0].target.schema.title, "보관 후 이름");
  assertEquals(run.saved[0].target.schema["x-icon"], "book");
  assertEquals(run.saved[0].target.schema.deprecated, true);
});

Deno.test("recovery retains later fields when their annotation orders collide with a restored field", async () => {
  const c = context(), run = usecase(c);
  c.source.schema.properties.prop_3 = { type: "integer", "x-order": 30 };
  c.current.schema.properties.prop_4 = { type: "string", "x-order": 30 };
  c.committed_target = initialEntityDefinition("이름");
  await run.create();
  assertEquals(run.saved[0].target.schema.properties.prop_3["x-order"], 30);
  assertEquals(run.saved[0].target.schema.properties.prop_4["x-order"], 40);
  assertEquals(run.saved[0].target.schema["x-title-template"], c.current.schema["x-title-template"]);
});

Deno.test("recovery preserves the current composed title and decodes legacy source properties without changing retained evidence", async () => {
  const c = context(), run = usecase(c);
  c.current.schema.properties.prop_4.deprecated = false;
  c.current.schema["x-title-template"] = "$prop_4$ / $prop_1$";
  delete (c.source.schema as Record<string, unknown>)["x-title-template"];
  Object.assign(c.source.schema.properties.prop_1, {
    "x-representative": true,
    "x-show-in-list": true,
    "x-list-order": 1,
  });
  const raw = structuredClone(c.source);
  await run.create();
  assertEquals(run.saved[0].target.schema["x-title-template"], "$prop_4$ / $prop_1$");
  assertEquals(run.saved[0].target.schema.properties.prop_1, initialEntityDefinition("이름").schema.properties.prop_1);
  assertEquals(c.source, raw);
});

Deno.test("recovery rejects a current title reference absent from restored properties before saving a proposal", async () => {
  const c = context(), run = usecase(c);
  c.current.schema.properties.prop_3 = { type: "string", "x-order": 30, title: "변환 후 항목" };
  c.committed_target.schema.properties.prop_3 = c.current.schema.properties.prop_3;
  c.current.schema["x-title-template"] = "$prop_3$";
  const error = await assertRejects(run.create);
  assertEquals((error as { code: string }).code, "invalid_input");
  assertEquals((error as { fields: { path: string }[] }).fields[0].path, "schema.x-title-template");
  assertEquals(run.saved, []);
});
