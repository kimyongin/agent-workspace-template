import { z } from "zod";
import {
  type EntitySchemaChange,
  type EntitySchemaChangeSummary,
  type SchemaAnalysisAccepted,
  schemaChangeAction,
  schemaChangeApply,
  schemaChangeCreate,
  schemaChangeList,
  schemaChangeUpdate,
} from "../../contracts/entity-schema-change.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import type { Actor } from "../shared/actor.ts";
import { invalidInput } from "../shared/errors.ts";
import { runWrite } from "../shared/request.ts";
export interface SchemaChangeStore {
  createChange(typeId: string, input: z.infer<typeof schemaChangeCreate>): Promise<EntitySchemaChange>;
  updateChange(typeId: string, id: string, input: z.infer<typeof schemaChangeUpdate>): Promise<EntitySchemaChange>;
  getChange(typeId: string, id: string): Promise<EntitySchemaChange>;
  listChanges(
    typeId: string,
    input: z.infer<typeof schemaChangeList>,
  ): Promise<{ items: EntitySchemaChangeSummary[]; next_before: string | null }>;
  analyzeChange(typeId: string, id: string, input: z.infer<typeof schemaChangeAction>): Promise<SchemaAnalysisAccepted>;
  applyChange(typeId: string, id: string, input: z.infer<typeof schemaChangeApply>): Promise<EntitySchemaChange>;
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
  return runWrite(d.uow, a, "entity-schema-change.create", typeId, i, (s) => s.createChange(typeId, i));
}
export function updateEntitySchemaChange(d: EntityTypeDeps, a: Actor, typeId: string, id: string, raw: unknown) {
  refs(typeId, id);
  const i = parse(schemaChangeUpdate, raw);
  return runWrite(d.uow, a, "entity-schema-change.update", [typeId, id], i, (s) => s.updateChange(typeId, id, i));
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
  return runWrite(d.uow, a, "entity-schema-change.apply", [typeId, id], i, (s) => s.applyChange(typeId, id, i));
}
export type SchemaChangeDepsStore = EntityTypeStore;
