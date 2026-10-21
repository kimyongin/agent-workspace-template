import { findRetainedSchemaRequest, replayRetainedSchemaRequest } from "./retained-requests.ts";
import type { SchemaMigrationStore } from "./schema-migrations.ts";
import type { SchemaChangeStore } from "./schema-changes.ts";
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
  type EntityTypeRef,
  entityTypeUpdate,
  initialEntityDefinition,
} from "../../contracts/entity-type.ts";
import type { WorkspaceEntry } from "../workspaces/application.ts";
import type { Actor } from "../shared/actor.ts";
import type { RequestStore } from "../shared/request.ts";
import { runWrite } from "../shared/request.ts";
import { AppError, notFound } from "../shared/errors.ts";
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
export interface EntityTypeStore extends RequestStore, SchemaChangeStore, SchemaMigrationStore {
  list(input: ReturnType<typeof entityTypeList.parse>): Promise<{ items: EntityType[]; next_cursor: string | null }>;
  get(id: string): Promise<EntityType | null>;
  create(
    input: ReturnType<typeof entityTypeCreate.parse>,
    definition: Pick<EntitySchemaVersion, "schema">,
  ): Promise<EntityType>;
  createImportedType(schema: EntitySchemaVersion["schema"]): Promise<EntityType>;
  update(id: string, input: ReturnType<typeof entityTypeUpdate.parse>): Promise<EntityType>;
  schema(
    id: string,
    version?: number,
  ): Promise<(EntitySchemaVersion & { type: EntityTypeRef }) | null>;
  history(
    input: ReturnType<typeof entitySchemaHistory.parse>,
  ): Promise<{ items: EntitySchemaVersionSummary[]; next_before: number | null }>;
}
export interface EntityTypeDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityTypeStore) => Promise<T>, entry?: WorkspaceEntry): Promise<T> };
}
export function listEntityTypes(d: EntityTypeDeps, actor: Actor, raw: unknown = {}) {
  const input = parse(entityTypeList, raw);
  return d.uow.run(actor, (store) => store.list(input));
}
export function getEntityType(d: EntityTypeDeps, actor: Actor, id: string) {
  id = parse(z.string().uuid(), id);
  return d.uow.run(actor, async (store) => {
    const saved = await store.get(id);
    if (!saved) throw notFound();
    return saved;
  });
}
const settingsWrite: WorkspaceEntry = {
  mode: "business",
  requirements: [{ target_kind: "settings", target_id: "*", access: "write" }],
};
function writing(d: EntityTypeDeps): EntityTypeDeps["uow"] {
  return { run: (actor, fn) => d.uow.run(actor, fn, settingsWrite) };
}
export async function createEntityType(d: EntityTypeDeps, actor: Actor, raw: unknown) {
  const retained = await findRetainedSchemaRequest<EntityType>({ uow: writing(d) }, actor, "entity-type.create", null, raw);
  if (retained.found) return retained.result as EntityType;
  const input = parse(entityTypeCreate, raw);
  return runWrite(
    writing(d),
    actor,
    "entity-type.create",
    null,
    input,
    (store) => store.create(input, initialEntityDefinition(input.initial_property_label)),
  );
}
export function updateEntityType(d: EntityTypeDeps, actor: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  if (
    raw && typeof raw === "object" && Object.hasOwn(raw, "expected_type_version") &&
    !entityTypeUpdate.safeParse(raw).success
  ) return replayRetainedSchemaRequest<EntityType>({ uow: writing(d) }, actor, "entity-type.update", id, raw);
  const input = parse(entityTypeUpdate, raw);
  return runWrite(writing(d), actor, "entity-type.update", id, input, (store) => store.update(id, input));
}
export function getEntitySchema(d: EntityTypeDeps, actor: Actor, raw: unknown) {
  const input = parse(entitySchemaRead, raw);
  return d.uow.run(actor, async (store) => {
    const value = await store.schema(input.type_id, input.schema_version);
    if (!value) throw notFound();
    return {
      ...value,
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
  }, { mode: "business", requirements: [{ target_kind: "settings", target_id: "*", access: "read" }] });
}

/** Storage adapters acquire locks before applying these shared business decisions. */
export function assertEntityTypeCapacity(count: number): void {
  if (count >= entitySchemaLimits.types) throw invalidInput("자료 종류는 64개까지 만들 수 있습니다");
}
export function entityTypeUpdateDecision(
  current: EntityType,
  input: ReturnType<typeof entityTypeUpdate.parse>,
): Pick<EntityType, "label" | "icon_id" | "archived"> | null {
  if (
    current.schema_version !== input.expected_schema_version
  ) {
    throw new AppError("schema_changed", "자료 종류나 속성 정의가 변경되었습니다. 최신 버전을 확인하세요.", undefined, {
      type_id: current.id,

      schema_version: current.schema_version,
    });
  }
  const next = {
    label: input.label ?? current.label,
    icon_id: input.icon_id ?? current.icon_id,
    archived: input.archived ?? current.archived,
  };
  return next.label === current.label && next.icon_id === current.icon_id && next.archived === current.archived
    ? null
    : next;
}

/** Prospective active-name policy; unchanged legacy duplicates remain editable. */
export function assertEntityTypeLabelAvailable(duplicate: boolean): void {
  if (duplicate) {
    throw invalidInput("같은 이름의 자료 종류가 있습니다. 다른 이름을 입력하세요", [{
      path: "label",
      message: "사용 중인 이름입니다",
    }]);
  }
}
