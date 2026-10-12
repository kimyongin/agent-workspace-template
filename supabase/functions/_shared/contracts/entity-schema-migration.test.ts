import { assertEquals } from "@std/assert";
import {
  schemaMigrationAction,
  schemaMigrationList,
  schemaMigrationStart,
  schemaRecoveryCreate,
} from "./entity-schema-migration.ts";
Deno.test("migration acceptance binds exact plan and source versions without coercion", () => {
  const input = {
    expected_change_version: 2,
    expected_type_version: 3,
    expected_schema_version: 1,
    analysis_id: "12345678-1234-4234-8234-123456789012",
    fingerprint: "a".repeat(64),
  };
  assertEquals(schemaMigrationStart.safeParse(input).success, true);
  assertEquals(schemaMigrationStart.safeParse({ ...input, expected_change_version: "2" }).success, false);
  assertEquals(schemaMigrationStart.safeParse({ ...input, owner_id: "other" }).success, false);
  assertEquals(schemaMigrationAction.safeParse({ expected_job_version: 0 }).success, false);
  assertEquals(schemaMigrationList.safeParse({ limit: 101 }).success, false);
});

Deno.test("recovery creation accepts only exact current and successful job versions", () => {
  const refs = { expected_job_version: 7, expected_type_version: 3, expected_schema_version: 2 };
  assertEquals(schemaRecoveryCreate.safeParse(refs).success, true);
  for (
    const extra of [{ entity_type_id: "other" }, { target: {} }, { properties: { prop_1: "overwrite" } }, {
      expected_job_version: "7",
    }]
  ) assertEquals(schemaRecoveryCreate.safeParse({ ...refs, ...extra }).success, false);
});
