import {
  entitySchemaHistory,
  entitySchemaLimits,
  entitySchemaPolicy,
  entitySchemaRead,
  type EntitySchemaResult,
  type EntitySchemaVersion,
  type EntitySchemaVersionSummary,
  type EntityType,
  entityTypeCreate,
  entityTypeList,
  entityTypeUpdate,
  initialEntityDefinition,
} from "../../contracts/entity-type.ts";
import type { Actor } from "../shared/actor.ts";
import type { RequestStore } from "../shared/request.ts";
import { runWrite } from "../shared/request.ts";
import { notFound } from "../shared/errors.ts";
import { z } from "zod";
import { invalidInput } from "../shared/errors.ts";
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidInput(
      "자료 종류 입력을 확인하세요",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}
export interface EntityTypeStore extends RequestStore {
  list(input: ReturnType<typeof entityTypeList.parse>): Promise<{ items: EntityType[]; next_cursor: string | null }>;
  get(id: string): Promise<EntityType | null>;
  create(
    input: ReturnType<typeof entityTypeCreate.parse>,
    definition: Pick<EntitySchemaVersion, "schema" | "display">,
  ): Promise<EntityType>;
  update(id: string, input: ReturnType<typeof entityTypeUpdate.parse>): Promise<EntityType>;
  schema(id: string, version?: number): Promise<EntitySchemaVersion | null>;
  history(
    input: ReturnType<typeof entitySchemaHistory.parse>,
  ): Promise<{ items: EntitySchemaVersionSummary[]; next_before: number | null }>;
}
export interface EntityTypeDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityTypeStore) => Promise<T>): Promise<T> };
}
export function listEntityTypes(d: EntityTypeDeps, actor: Actor, raw: unknown = {}) {
  const input = parse(entityTypeList, raw);
  return d.uow.run(actor, (store) => store.list(input));
}
export function getEntityType(d: EntityTypeDeps, actor: Actor, id: string) {
  return d.uow.run(actor, async (store) => {
    const saved = await store.get(id);
    if (!saved) throw notFound();
    return saved;
  });
}
export function createEntityType(d: EntityTypeDeps, actor: Actor, raw: unknown) {
  const input = parse(entityTypeCreate, raw);
  return runWrite(
    d.uow,
    actor,
    "entity-type.create",
    null,
    input,
    (store) => store.create(input, initialEntityDefinition(input.representative_label)),
  );
}
export function updateEntityType(d: EntityTypeDeps, actor: Actor, id: string, raw: unknown) {
  const input = parse(entityTypeUpdate, raw);
  return runWrite(d.uow, actor, "entity-type.update", id, input, (store) => store.update(id, input));
}
export function getEntitySchema(d: EntityTypeDeps, actor: Actor, raw: unknown) {
  const input = parse(entitySchemaRead, raw);
  return d.uow.run(actor, async (store) => {
    const value = await store.schema(input.type_id, input.schema_version);
    if (!value) throw notFound();
    const type = await store.get(input.type_id);
    if (!type) throw notFound();
    return {
      ...value,
      type: { id: type.id, label: type.label, icon_id: type.icon_id, archived: type.archived },
      type_version: type.version,
      constraints: entitySchemaLimits,
      policy: entitySchemaPolicy,
    } satisfies EntitySchemaResult;
  });
}
export function listEntitySchemaVersions(d: EntityTypeDeps, actor: Actor, raw: unknown) {
  const input = parse(entitySchemaHistory, raw);
  return d.uow.run(actor, async (store) => {
    if (!await store.get(input.type_id)) throw notFound();
    return store.history(input);
  });
}
