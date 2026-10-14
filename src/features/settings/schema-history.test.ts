import { expect, it } from "vitest";
import { schemaHistoryRows } from "./schema-history.ts";
import type { EntitySchemaChangeSummary } from "@contracts/entity-schema-change.ts";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
const change = (
  id: string,
  source: number,
  status: EntitySchemaChangeSummary["status"] = "applied",
): EntitySchemaChangeSummary => ({
  id,
  type_id: "type",
  source_schema_version: source,
  version: 1,
  status,
  change_kind: "compatible",
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
});
const version = (n: number) => ({ type_id: "type", schema_version: n, created_at: `2026-10-${12 + n}T00:00:00Z` });
const job = (id: string, changeId: string, resultVersion?: number) => ({
  id,
  change_id: changeId,
  type_id: "type",
  status: resultVersion ? "succeeded" : "failed",
  created_at: "2026-10-14T00:00:00Z",
  result: resultVersion ? { schema_version: resultVersion, committed_at: "2026-10-15T00:00:00Z" } : null,
} as EntitySchemaMigration);
it("같은 시각의 폐기·미적용안을 버전에 연결하지 않고 확정 변경과 버전을 한 행으로 묶는다", () => {
  const rows = schemaHistoryRows([change("done", 1), change("discard", 1, "cancelled"), change("ready", 1, "ready")], [
    version(2),
    version(1),
  ], []);
  expect(rows).toHaveLength(4);
  expect(rows.find((r) => r.changeId === "done")?.version?.schema_version).toBe(2);
  expect(rows.find((r) => r.changeId === "discard")?.version).toBeUndefined();
  expect(rows.find((r) => r.changeId === "ready")?.version).toBeUndefined();
  expect(rows.filter((r) => r.version?.schema_version === 1)).toHaveLength(1);
});
it("변환 성공이 먼저 도착해도 같은 행에 버전을 연결하고 여러 실행을 보존한다", () => {
  const rows = schemaHistoryRows([change("done", 1, "ready")], [version(2)], [
    job("old", "done"),
    job("new", "done", 2),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].jobs.map((j) => j.id)).toEqual(["old", "new"].sort().reverse());
  expect(rows[0].version?.schema_version).toBe(2);
});
it("다른 페이지의 변경을 아직 읽지 않아도 변환 이력을 보존하고 조회 뒤 같은 ID로 연결한다", () => {
  const before = schemaHistoryRows([], [version(3), version(1)], [job("job", "old", 3)]);
  const after = schemaHistoryRows([change("old", 2)], [version(3), version(1)], [job("job", "old", 3)]);
  expect(before.map((r) => r.id)).toEqual(after.map((r) => r.id));
  expect(after).toHaveLength(2);
  expect(after[0].changeId).toBe("old");
});
it("연결 없는 버전을 숨기지 않고 최초 버전과 과거 적용을 시간순으로 유지한다", () => {
  const rows = schemaHistoryRows([change("older", 1)], [version(3), version(2), version(1)], []);
  expect(rows.map((r) => r.version?.schema_version)).toEqual([3, 2, 1]);
});
