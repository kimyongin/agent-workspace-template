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
import { invalidInput } from "../shared/errors.ts";
import { runWrite } from "../shared/request.ts";
export interface SchemaMigrationStore {
  createRecovery(
    id: string,
    input: z.infer<typeof schemaRecoveryCreate>,
  ): Promise<import("../../contracts/entity-schema-change.ts").EntitySchemaChange>;
  startMigration(
    typeId: string,
    changeId: string,
    input: z.infer<typeof schemaMigrationStart>,
  ): Promise<SchemaMigrationAccepted>;
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
    (s) => s.startMigration(typeId, changeId, i),
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
  return runWrite(d.uow, a, "entity-schema-migration.recovery", id, i, (s) => s.createRecovery(id, i));
}
