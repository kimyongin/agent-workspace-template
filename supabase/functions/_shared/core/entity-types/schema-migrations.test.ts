import { assertEquals, assertRejects } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import type { RecoveryContext, RecoveryProposal } from "./recovery-policy.ts";
import { createEntitySchemaRecovery } from "./schema-migrations.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
function context(): RecoveryContext {
  const source = initialEntityDefinition("이름"), current = structuredClone(source);
  current.schema.properties.prop_3 = { type: "string", title: "현재만 존재", enum: ["value"] };
  current.schema.required.push("prop_3");
  current.display.order.push("prop_3");
  current.display.archived.push("prop_3");
  current.display.option_labels.prop_3 = { value: "표시 이름" };
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
        { expected_job_version: 4, expected_type_version: 3, expected_schema_version: 2 },
      ),
  };
}
Deno.test("recovery creation retains current-only field values and presentation in its new proposal", async () => {
  const c = context(), run = usecase(c);
  await run.create();
  assertEquals(run.saved.length, 1);
  assertEquals(run.saved[0].target, c.current);
  assertEquals(run.saved[0].keys, ["prop_1"]);
  assertEquals(c.source.schema.required, ["prop_1"]);
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
      { expected_job_version: 4, expected_type_version: 3, expected_schema_version: 2 },
    )
  );
  assertEquals((e as { code: string }).code, "migration_source_expired");
  assertEquals(run.saved, []);
});
