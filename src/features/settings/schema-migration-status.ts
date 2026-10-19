import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";

export const migrationLabels: Record<EntitySchemaMigration["status"], string> = {
  queued: "접수",
  preparing: "준비 중",
  ready_to_commit: "적용 준비 완료",
  committing: "적용 중",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소",
};
