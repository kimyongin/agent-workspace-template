import type {
  EntitySchemaChange,
  MigrationPlan,
  SchemaDefinition,
  SchemaDiff,
} from "../../contracts/entity-schema-change.ts";
import type { RecordTemplates } from "../../contracts/record-template.ts";
import { AppError, conflict, invalidInput } from "../shared/errors.ts";
import { assertRecoveryFresh, type RecoveryEvidence } from "./recovery-policy.ts";
import { assertSchemaTemplateReferences, effectiveEntityTemplateFingerprint } from "./template-references.ts";
export type SchemaApplicationContext = {
  type: {
    id: string;
    label: string;
    icon_id: string;
    version: number;
    schema_version: number;
    archived: boolean;
    schema_write_locked: boolean;
  };
  change: {
    id: string;
    version: number;
    status: EntitySchemaChange["status"];
    kind: EntitySchemaChange["change_kind"];
    source_type_version: number;
    source_schema_version: number;
    analysis_id: string | null;
    fingerprint: string;
    source_template_fingerprint: string;
    target: SchemaDefinition;
    diff: SchemaDiff[];
    migration: MigrationPlan;
    recovery_source_job_id: string | null;
    recovery_keys: string[] | null;
  };
  analysis: {
    id: string;
    status: string;
    failed: number;
    change_version: number;
    fingerprint: string;
    membership: string;
    total: number;
  } | null;
  membership: string;
};
export type SchemaApplicationBindings = {
  templates: RecordTemplates;
  recovery: { evidence: RecoveryEvidence; observed_at: string } | null;
};
export function assertSchemaApplication(
  context: SchemaApplicationContext,
  path: "compatible" | "migration_required",
  input: {
    expected_change_version: number;
    analysis_id: string;
    expected_schema_version?: number;
    fingerprint?: string;
  },
) {
  const { type, change } = context;
  if (type.schema_write_locked) {
    throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
  }
  if (change.version !== input.expected_change_version) throw conflict("변경 초안 버전이 변경되었습니다");
  if (["applied", "cancelled"].includes(change.status)) throw conflict("완료된 변경은 수정할 수 없습니다");
  assertSchemaApplicationSource(
    context,
    change.source_type_version,
    input.expected_schema_version ?? change.source_schema_version,
  );
  if (input.fingerprint !== undefined && change.fingerprint !== input.fingerprint) {
    throw new AppError("schema_plan_stale", "확인한 변경안과 실행 요청이 다릅니다");
  }
  assertSchemaApplicationSource(context, change.source_type_version, change.source_schema_version);
  assertSchemaApplicationReady(context, path, input.analysis_id);
}
export function assertSchemaApplicationSource(context: SchemaApplicationContext, version: number, schema: number) {
  const { type } = context;
  if (type.schema_version !== schema) {
    throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
      type_id: type.id,

      schema_version: type.schema_version,
    });
  }
  const propertiesChanged = context.change.diff.some((d) => d.path.startsWith("properties."));
  if (
    type.archived && !context.change.recovery_source_job_id && propertiesChanged &&
    context.change.target.schema.deprecated !== false
  ) throw new AppError("entity_type_archived", "보관된 자료 종류를 먼저 복원하세요");
  void version;
}
export function assertSchemaApplicationReady(
  context: SchemaApplicationContext,
  path: "compatible" | "migration_required",
  analysisId: string,
) {
  const { change, analysis } = context;
  // A zero-row analysis is still bound to the current membership, versions and templates.
  // Recovery always follows its durable source-retention path.
  const emptyPublication = path === "compatible" && analysis?.total === 0 && !change.recovery_source_job_id;
  if (change.kind !== path && !emptyPublication) {
    if (path === "migration_required") throw invalidInput("호환 가능한 변경은 새 버전 게시를 사용하세요");
    throw new AppError(
      "schema_migration_required",
      "이 변경은 값 변환 작업이 필요합니다",
      change.diff.filter((d) => d.kind === "migration_required").map((d) => ({ path: d.path, message: d.reason })),
    );
  }
  if (
    change.status !== "ready" || change.analysis_id !== analysisId || !analysis ||
    analysis.id !== analysisId ||
    analysis.status !== "succeeded" || analysis.failed !== 0 || analysis.change_version !== change.version ||
    analysis.fingerprint !== change.fingerprint || analysis.membership !== context.membership
  ) {
    throw new AppError(
      "schema_plan_stale",
      path === "compatible" ? "최신 영향 분석을 완료하세요" : "최신 성공 분석을 준비하세요",
    );
  }
}
export async function assertSchemaApplicationBindings(
  context: SchemaApplicationContext,
  bindings: SchemaApplicationBindings,
) {
  if (bindings.recovery) assertRecoveryFresh(bindings.recovery.evidence, new Date(bindings.recovery.observed_at));
  if (
    await effectiveEntityTemplateFingerprint(bindings.templates, context.type.id) !==
      context.change.source_template_fingerprint
  ) throw new AppError("schema_plan_stale", "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
  assertSchemaTemplateReferences(context.change.target, bindings.templates, context.type.id);
}
