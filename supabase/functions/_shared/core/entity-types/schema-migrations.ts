import {
  assertSchemaApplication,
  assertSchemaApplicationBindings,
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
import type { Actor } from "../shared/actor.ts";
import { AppError, conflict, invalidInput } from "../shared/errors.ts";
import { runWrite } from "../shared/request.ts";
export interface SchemaMigrationStore {
  loadRecovery(id: string): Promise<RecoveryContext>;
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
  cancelMigration(id: string, input: z.infer<typeof schemaMigrationAction>): Promise<EntitySchemaMigration>;
  retryMigration(id: string, input: z.infer<typeof schemaMigrationAction>): Promise<SchemaMigrationAccepted>;
}
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
export function cancelEntitySchemaMigration(d: EntityTypeDeps, a: Actor, id: string, raw: unknown) {
  parse(z.string().uuid(), id);
  const i = parse(schemaMigrationAction, raw);
  return runWrite(d.uow, a, "entity-schema-migration.cancel", id, i, (s) => s.cancelMigration(id, i));
}
export function retryEntitySchemaMigration(d: EntityTypeDeps, a: Actor, id: string, raw: unknown) {
  parse(z.string().uuid(), id);
  const i = parse(schemaMigrationAction, raw);
  return runWrite(d.uow, a, "entity-schema-migration.retry", id, i, (s) => s.retryMigration(id, i));
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
    return s.saveRecovery(context, await recoveryProposal(context, target, templates));
  });
}
