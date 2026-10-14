import {
  assertSchemaApplication,
  assertSchemaApplicationBindings,
  type SchemaApplicationBindings,
  type SchemaApplicationContext,
} from "./schema-application.ts";
import { z } from "zod";
import {
  type EntitySchemaChange,
  type EntitySchemaChangeSummary,
  type SchemaAnalysisAccepted,
  type SchemaAnalysisPage,
  schemaAnalysisRows,
  schemaChangeAction,
  schemaChangeApply,
  schemaChangeCreate,
  schemaChangeList,
  schemaChangeUpdate,
} from "../../contracts/entity-schema-change.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, conflict, invalidInput } from "../shared/errors.ts";
import { runWrite } from "../shared/request.ts";
import type { RecordTemplates } from "../../contracts/record-template.ts";
import type { SchemaDefinition, SchemaEdit } from "../../contracts/entity-schema-change.ts";
import { canonical, definitionFingerprint, resolveSchemaEdits } from "./evolution.ts";
import { compileMigration } from "./conversions.ts";
import { assertSchemaTemplateReferences, effectiveEntityTemplateFingerprint } from "./template-references.ts";

type ChangeInput = z.infer<typeof schemaChangeCreate>;
export type SchemaChangeDraftContext = {
  type: { id: string; version: number; schema_version: number; archived: boolean; schema_write_locked: boolean };
  definition: SchemaDefinition;
  previous:
    | Pick<
      EntitySchemaChange,
      | "id"
      | "version"
      | "status"
      | "source_type_version"
      | "source_schema_version"
      | "source_template_fingerprint"
      | "edits"
      | "migration"
      | "reservations"
    >
      & { recovery_source_job_id: string | null }
    | null;
};
export type PreparedSchemaChange = ChangeInput & {
  source_template_fingerprint: string;
  reservations: Record<string, string>;
  target: SchemaDefinition;
  diff: EntitySchemaChange["diff"];
  kind: EntitySchemaChange["change_kind"];
  fingerprint: string;
};
export interface SchemaChangeStore {
  loadSchemaChangeDraft(typeId: string): Promise<SchemaChangeDraftContext>;
  lockExistingSchemaChange(typeId: string, id: string): Promise<NonNullable<SchemaChangeDraftContext["previous"]>>;
  reserveSchemaChangeProperties(
    typeId: string,
    edits: SchemaEdit[],
    prior: Record<string, string>,
  ): Promise<Record<string, string>>;
  lockSchemaChangeBindings(typeId: string, entityIds: string[]): Promise<RecordTemplates>;
  saveSchemaChangeDraft(context: SchemaChangeDraftContext, prepared: PreparedSchemaChange): Promise<EntitySchemaChange>;
  loadSchemaDiscard(typeId: string, id: string): Promise<{
    change: Pick<EntitySchemaChange, "version" | "status">;
    migration_active: boolean;
  }>;
  saveSchemaDiscard(typeId: string, id: string): Promise<EntitySchemaChange>;
  getChange(typeId: string, id: string): Promise<EntitySchemaChange>;
  listChanges(
    typeId: string,
    input: z.infer<typeof schemaChangeList>,
  ): Promise<{ items: EntitySchemaChangeSummary[]; next_before: string | null }>;
  analyzeChange(typeId: string, id: string, input: z.infer<typeof schemaChangeAction>): Promise<SchemaAnalysisAccepted>;
  analysisRows(typeId: string, id: string, input: z.infer<typeof schemaAnalysisRows>): Promise<SchemaAnalysisPage>;
  loadSchemaApplication(typeId: string, id: string, analysisId: string): Promise<SchemaApplicationContext>;
  lockSchemaApplicationBindings(context: SchemaApplicationContext): Promise<SchemaApplicationBindings>;
  saveSchemaPublication(context: SchemaApplicationContext, nextSchemaVersion: number): Promise<EntitySchemaChange>;
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw invalidInput(
      "속성 변경 입력을 확인하세요",
      r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}
function refs(typeId: string, id?: string) {
  parse(z.string().uuid(), typeId);
  if (id) parse(z.string().uuid(), id);
}
export function createEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, raw: unknown) {
  refs(typeId);
  const i = parse(schemaChangeCreate, raw);
  return runWrite(d.uow, a, "entity-schema-change.create", typeId, i, (s) => prepareSchemaChange(s, typeId, i));
}
export function updateEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const i = parse(schemaChangeUpdate, raw);
  return runWrite(
    d.uow,
    a,
    "entity-schema-change.update",
    [typeId, id],
    i,
    (s) => prepareSchemaChange(s, typeId, i, id),
  );
}
async function prepareSchemaChange(
  s: SchemaChangeStore,
  typeId: string,
  input: ChangeInput & { expected_change_version?: number },
  id?: string,
) {
  const context = await s.loadSchemaChangeDraft(typeId);
  const t = context.type;
  if (t.schema_write_locked) throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
  if (t.version !== input.expected_type_version || t.schema_version !== input.expected_schema_version) {
    throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
      type_id: t.id,
      type_version: t.version,
      schema_version: t.schema_version,
    });
  }
  if (t.archived) throw new AppError("entity_type_archived", "보관된 자료 종류를 먼저 복원하세요");
  const previous = id ? await s.lockExistingSchemaChange(typeId, id) : null;
  context.previous = previous;
  if (previous) {
    if (previous.version !== input.expected_change_version) throw conflict("변경 초안 버전이 변경되었습니다");
    if (["applied", "cancelled"].includes(previous.status)) throw conflict("완료된 변경은 수정할 수 없습니다");
    if (
      previous.source_type_version !== input.expected_type_version ||
      previous.source_schema_version !== input.expected_schema_version
    ) {
      throw new AppError("schema_plan_stale", "새 정의를 기준으로 새 변경을 만드세요");
    }
    if (previous.recovery_source_job_id) {
      throw conflict("복구 초안은 원본에 결속됩니다. 현재 변경을 수동 보완한 후 새 복구안과 분석을 준비하세요");
    }
  }
  const reservations = await s.reserveSchemaChangeProperties(typeId, input.edits, previous?.reservations ?? {});
  const resolved = resolveSchemaEdits(context.definition, input.edits, reservations);
  for (const rule of input.migration.rules) {
    if (rule.op === "remove" && !input.edits.some((e) => e.op === "remove_property" && e.key === rule.key)) {
      throw invalidInput("속성 제거 편집과 같은 키의 명시 제거만 지원합니다");
    }
  }
  const templates = await s.lockSchemaChangeBindings(typeId, [
    ...new Set(input.migration.overrides.map((o) => o.entity_id)),
  ]);
  compileMigration(resolved.target, input.migration);
  const kind = input.migration.rules.length || input.migration.overrides.length ? "migration_required" : resolved.kind;
  const templateVersion = await effectiveEntityTemplateFingerprint(templates, typeId);
  if (previous && templateVersion !== previous.source_template_fingerprint) {
    throw new AppError("schema_plan_stale", "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
  }
  assertSchemaTemplateReferences(resolved.target, templates, typeId);
  if (
    previous && canonical(input.edits) === canonical(previous.edits) &&
    canonical(input.migration) === canonical(previous.migration)
  ) {
    return s.getChange(typeId, previous.id);
  }
  const fingerprint = await definitionFingerprint({
    type_id: typeId,
    source_type_version: t.version,
    source_schema_version: t.schema_version,
    source_template_fingerprint: templateVersion,
    edits: input.edits,
    migration: input.migration,
    reservations,
    target: resolved.target,
  });
  return s.saveSchemaChangeDraft(context, {
    ...input,
    source_template_fingerprint: templateVersion,
    reservations,
    ...resolved,
    kind,
    fingerprint,
  });
}
export function getEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string) {
  refs(typeId, id);
  return d.uow.run(a, (s) => s.getChange(typeId, id));
}
export function listEntitySchemaChanges(d: EntityTypeDeps, a: Actor, typeId: string, raw: unknown = {}) {
  refs(typeId);
  const i = parse(schemaChangeList, raw);
  return d.uow.run(a, (s) => s.listChanges(typeId, i));
}
export function analyzeEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const i = parse(schemaChangeAction, raw);
  return runWrite(d.uow, a, "entity-schema-change.analyze", [typeId, id], i, (s) => s.analyzeChange(typeId, id, i));
}
export function applyEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const i = parse(schemaChangeApply, raw);
  return runWrite(d.uow, a, "entity-schema-change.apply", [typeId, id], i, async (s) => {
    const context = await s.loadSchemaApplication(typeId, id, i.analysis_id);
    assertSchemaApplication(context, "compatible", i);
    await assertSchemaApplicationBindings(context, await s.lockSchemaApplicationBindings(context));
    return s.saveSchemaPublication(context, context.type.schema_version + 1);
  });
}
export type SchemaChangeDepsStore = EntityTypeStore;

export function getEntitySchemaAnalysisRows(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const i = parse(schemaAnalysisRows, raw);
  return d.uow.run(a, (s) => s.analysisRows(typeId, id, i));
}

export function discardEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const input = parse(schemaChangeAction, raw);
  return runWrite(d.uow, a, "entity-schema-change.discard", [typeId, id], input, async (store) => {
    const { change, migration_active } = await store.loadSchemaDiscard(typeId, id);
    if (change.status === "cancelled") return store.getChange(typeId, id);
    if (change.status === "applied") throw conflict("이미 적용한 변경은 폐기할 수 없습니다");
    if (change.version !== input.expected_change_version) throw conflict("변경안 버전이 변경되었습니다");
    if (migration_active) throw conflict("진행 중인 값 변환을 먼저 취소하세요");
    return store.saveSchemaDiscard(typeId, id);
  });
}
