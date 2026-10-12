import {
  assertSchemaApplication,
  assertSchemaApplicationBindings,
  assertSchemaApplicationReady,
  assertSchemaApplicationSource,
  type SchemaApplicationContext,
} from "./schema-application.ts";
import {
  assertRecoveryFresh,
  assessRecovery,
  type RecoveryContext,
  type RecoveryProposal,
  recoveryProposal,
  recoveryTarget,
} from "./recovery-policy.ts";
import { z } from "zod";
import {
  type EntitySchemaMigration,
  type SchemaMigrationAccepted,
  schemaMigrationAction,
  schemaMigrationList,
  schemaMigrationStart,
  schemaRecoveryCreate,
} from "../../contracts/entity-schema-migration.ts";
import type { EntityTypeDeps } from "./application.ts";
import type { SchemaChangeStore } from "./schema-changes.ts";
import type { RequestStore } from "../shared/request.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, conflict, invalidInput } from "../shared/errors.ts";
import { runWrite } from "../shared/request.ts";
export interface SchemaMigrationStore {
  loadRecovery(id: string): Promise<RecoveryContext>;
  recoveryObservedAt(): Promise<string>;
  recoveryTemplates(typeId: string, target: RecoveryContext["source"]): Promise<string>;
  saveRecovery(
    context: RecoveryContext,
    proposal: RecoveryProposal,
  ): Promise<import("../../contracts/entity-schema-change.ts").EntitySchemaChange>;
  saveSchemaMigration(context: SchemaApplicationContext): Promise<SchemaMigrationAccepted>;
  getMigration(id: string): Promise<EntitySchemaMigration>;
  listMigrations(
    input: z.infer<typeof schemaMigrationList>,
  ): Promise<{ items: EntitySchemaMigration[]; next_before: string | null }>;
  loadMigrationAction(id: string): Promise<SchemaMigrationActionContext>;
  saveMigrationCancellation(job: SchemaMigrationActionContext["job"]): Promise<EntitySchemaMigration>;
  saveMigrationRetry(job: SchemaMigrationActionContext["job"]): Promise<SchemaMigrationAccepted>;
  migrationReferencesFresh(id: string): Promise<boolean>;
}
export type SchemaMigrationActionContext = {
  job: Pick<
    EntitySchemaMigration,
    | "id"
    | "type_id"
    | "change_id"
    | "change_version"
    | "analysis_id"
    | "fingerprint"
    | "version"
    | "status"
    | "retryable"
    | "source_expires_at"
  >;
  schema_write_locked: boolean;
  observed_at: string;
};
export type SchemaMigrationActionStore =
  & RequestStore
  & Pick<
    SchemaMigrationStore,
    | "loadMigrationAction"
    | "getMigration"
    | "saveMigrationCancellation"
    | "saveMigrationRetry"
    | "migrationReferencesFresh"
  >
  & Pick<SchemaChangeStore, "loadSchemaApplication" | "lockSchemaApplicationBindings">;
type SchemaMigrationActionDeps = {
  uow: { run<T>(actor: Actor, fn: (store: SchemaMigrationActionStore) => Promise<T>): Promise<T> };
};
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidInput(
      "값 변환 작업 입력을 확인하세요",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
export function startEntitySchemaMigration(
  d: EntityTypeDeps,
  a: Actor,
  typeId: string,
  changeId: string,
  raw: unknown,
) {
  parse(z.string().uuid(), typeId);
  parse(z.string().uuid(), changeId);
  const i = parse(schemaMigrationStart, raw);
  return runWrite(
    d.uow,
    a,
    "entity-schema-migration.start",
    [typeId, changeId],
    i,
    async (s) => {
      const context = await s.loadSchemaApplication(typeId, changeId, i.analysis_id);
      assertSchemaApplication(context, "migration_required", i);
      await assertSchemaApplicationBindings(context, await s.lockSchemaApplicationBindings(context));
      return s.saveSchemaMigration(context);
    },
  );
}
export function getEntitySchemaMigration(d: EntityTypeDeps, a: Actor, id: string) {
  parse(z.string().uuid(), id);
  return d.uow.run(a, (s) => s.getMigration(id));
}
export function listEntitySchemaMigrations(d: EntityTypeDeps, a: Actor, raw: unknown = {}) {
  const i = parse(schemaMigrationList, raw);
  return d.uow.run(a, (s) => s.listMigrations(i));
}
export function cancelEntitySchemaMigration(d: SchemaMigrationActionDeps, a: Actor, id: string, raw: unknown) {
  parse(z.string().uuid(), id);
  const i = parse(schemaMigrationAction, raw);
  return runWrite(d.uow, a, "entity-schema-migration.cancel", id, i, async (s) => {
    const { job } = await s.loadMigrationAction(id);
    // A locked terminal result wins over an outdated caller, including the commit winner.
    if (["committing", "succeeded", "failed", "cancelled"].includes(job.status)) return s.getMigration(id);
    if (job.version !== i.expected_job_version) throw conflict("작업 상태가 변경되었습니다. 다시 조회하세요");
    return s.saveMigrationCancellation(job);
  });
}
export function retryEntitySchemaMigration(d: SchemaMigrationActionDeps, a: Actor, id: string, raw: unknown) {
  parse(z.string().uuid(), id);
  const i = parse(schemaMigrationAction, raw);
  return runWrite(d.uow, a, "entity-schema-migration.retry", id, i, async (s) => {
    const { job, schema_write_locked, observed_at } = await s.loadMigrationAction(id);
    if (schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
    }
    if (job.version !== i.expected_job_version) throw conflict("작업 상태가 변경되었습니다. 다시 조회하세요");
    if (job.source_expires_at && new Date(job.source_expires_at) <= new Date(observed_at)) {
      throw new AppError("migration_source_expired", "재시도 원본의 30일 보관 기간이 지났습니다. 새 분석을 준비하세요");
    }
    if (job.status !== "failed" || !job.retryable) {
      throw conflict("재시도 가능한 실패 작업만 재개할 수 있습니다. 새 분석을 준비하세요");
    }
    const context = await s.loadSchemaApplication(job.type_id, job.change_id, job.analysis_id);
    const change = context.change;
    if (
      change.version !== job.change_version || change.fingerprint !== job.fingerprint ||
      change.analysis_id !== job.analysis_id
    ) {
      throw new AppError("schema_plan_stale", "새 분석을 준비하세요");
    }
    assertSchemaApplicationSource(context, change.source_type_version, change.source_schema_version);
    assertSchemaApplicationReady(context, "migration_required", job.analysis_id);
    await assertSchemaApplicationBindings(context, await s.lockSchemaApplicationBindings(context));
    if (!await s.migrationReferencesFresh(id)) {
      throw new AppError("schema_plan_stale", "연결이 변경되었습니다. 새 분석을 준비하세요");
    }
    return s.saveMigrationRetry(job);
  });
}

export function createEntitySchemaRecovery(d: EntityTypeDeps, a: Actor, id: string, raw: unknown) {
  parse(z.string().uuid(), id);
  const i = parse(schemaRecoveryCreate, raw);
  return runWrite(d.uow, a, "entity-schema-migration.recovery", id, i, async (s) => {
    const context = await s.loadRecovery(id);
    const now = new Date(context.observed_at), type = context.evidence.type;
    if (assessRecovery(context.evidence, now).status === "expired") assertRecoveryFresh(context.evidence, now);
    if (type.schema_write_locked) {
      throw new AppError("schema_migration_in_progress", "마이그레이션 완료 후 다시 시도하세요");
    }
    if (type.version !== i.expected_type_version || type.schema_version !== i.expected_schema_version) {
      throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다", undefined, {
        type_id: type.id,
        type_version: type.version,
        schema_version: type.schema_version,
      });
    }
    if (type.archived) throw new AppError("entity_type_archived", "보관된 자료 종류를 먼저 복원하세요");
    if (context.job_version !== i.expected_job_version) throw conflict("작업 버전이 변경되었습니다. 다시 조회하세요");
    assertRecoveryFresh(context.evidence, now);
    const target = recoveryTarget(context);
    const templates = await s.recoveryTemplates(type.id, target);
    const proposal = await recoveryProposal(context, target, templates);
    assertRecoveryFresh(context.evidence, new Date(await s.recoveryObservedAt()));
    return s.saveRecovery(context, proposal);
  });
}
