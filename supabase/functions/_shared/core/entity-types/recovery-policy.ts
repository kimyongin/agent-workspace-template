import type { SchemaDefinition, SchemaDiff } from "../../contracts/entity-schema-change.ts";
import type { EntitySchemaMigration } from "../../contracts/entity-schema-migration.ts";
import { AppError, conflict } from "../shared/errors.ts";
import { definitionFingerprint, schemaDefinitionDiff } from "./evolution.ts";
import { validateEntityDefinition } from "./schema-rules.ts";
export type RecoveryEvidence = {
  status: EntitySchemaMigration["status"];
  expires_at: string | null;
  material_present: boolean;
  retained: number;
  total: number;
  values_match: boolean;
  references_match: boolean;
  conflicts: Array<{ path: string; message: string }>;
  type: { id: string; version: number; schema_version: number; archived: boolean; schema_write_locked: boolean };
};
export function assessRecovery(e: RecoveryEvidence, now: Date): NonNullable<EntitySchemaMigration["recovery"]> {
  let status: NonNullable<EntitySchemaMigration["recovery"]>["status"] = "available", reason: string | null = null;
  const conflicts = [...e.conflicts];
  if (e.status !== "succeeded") {
    status = "unavailable";
    reason = "성공한 작업에서만 복구안을 만들 수 있습니다";
  } else if (e.expires_at && Date.parse(e.expires_at) <= now.getTime()) {
    status = "expired";
    reason = "복구 원본의 30일 보관 기간이 지났습니다";
  } else if (!e.expires_at || !e.material_present || e.retained !== e.total) {
    status = "unavailable";
    reason = "복구 원본 또는 확정 기준 자료가 없습니다";
  } else if (!e.values_match || !e.references_match) {
    status = "conflict";
    reason = "완료 후 값·자료 구성·연결 선택이 변경되었습니다. 수동 보완과 새 분석이 필요합니다";
  }
  return {
    status,
    reason,
    conflicts: conflicts.slice(0, 21),
    current_schema_version: e.type.schema_version,
  };
}
export function assertRecoveryFresh(e: RecoveryEvidence, now: Date) {
  const result = assessRecovery(e, now);
  if (result.status === "expired") throw new AppError("migration_source_expired", result.reason!);
  if (result.status === "unavailable") throw conflict(result.reason!);
  if (result.status === "conflict") throw new AppError("schema_plan_stale", result.reason!, result.conflicts);
}
export type RecoveryContext = {
  job_id: string;
  job_version: number;
  observed_at: string;
  evidence: RecoveryEvidence;
  source: SchemaDefinition;
  committed_target: SchemaDefinition;
  current: SchemaDefinition;
  committed_membership: string;
  committed_references: unknown;
};
export type RecoveryProposal = {
  target: SchemaDefinition;
  templates: string;
  fingerprint: string;
  diff: SchemaDiff[];
  keys: string[];
};
export function recoveryTarget(context: RecoveryContext): SchemaDefinition {
  const target = {
    schema: {
      ...structuredClone(context.current.schema),
      properties: structuredClone(context.source.schema.properties),
      required: [...context.source.schema.required],
    },
  };
  const orders = new Set(Object.values(target.schema.properties).map((f) => f["x-order"]));
  const listOrders = new Set(
    Object.values(target.schema.properties).filter((f) => f["x-show-in-list"] && !f.deprecated).map((f) =>
      f["x-list-order"] ?? f["x-order"]
    ),
  );
  for (
    const [key, field] of Object.entries(context.current.schema.properties).sort(([, a], [, b]) =>
      a["x-order"] - b["x-order"]
    )
  ) {
    if (
      !Object.hasOwn(target.schema.properties, key) && !Object.hasOwn(context.committed_target.schema.properties, key)
    ) {
      const later = structuredClone(field);
      if (orders.has(later["x-order"])) later["x-order"] = Math.max(...orders) + 10;
      orders.add(later["x-order"]);
      if (later["x-representative"]) later["x-representative"] = false;
      if (later["x-show-in-list"] && !later.deprecated) {
        let order = later["x-list-order"] ?? later["x-order"];
        if (listOrders.has(order)) {
          order = Math.max(...listOrders) + 10;
          later["x-list-order"] = order;
        }
        listOrders.add(order);
      }
      target.schema.properties[key] = later;
      if (context.current.schema.required.includes(key)) target.schema.required.push(key);
    }
  }
  validateEntityDefinition(target);
  return target;
}
export async function recoveryProposal(
  context: RecoveryContext,
  target: SchemaDefinition,
  templates: string,
): Promise<RecoveryProposal> {
  const diff = schemaDefinitionDiff(context.current, target);
  return {
    target,
    templates,
    fingerprint: await definitionFingerprint({
      source_job_id: context.job_id,
      source_type_version: context.evidence.type.version,
      source_schema_version: context.evidence.type.schema_version,
      target,
      templates,
      committed_membership: context.committed_membership,
      committed_references: context.committed_references,
    }),
    diff: diff.length ? diff : [{
      path: "recovery",
      before: "현재 자료 값",
      after: "보존된 원본 값",
      before_present: true,
      after_present: true,
      kind: "migration_required",
      reason: "보존된 원본과 현재 속성을 검증하는 새 복구 버전",
      next_action: "분석·미리보기 후 값 변환 작업을 실행하세요",
    }],
    keys: [
      ...new Set([
        ...Object.keys(context.source.schema.properties),
        ...Object.keys(context.committed_target.schema.properties),
      ]),
    ],
  };
}
