import { z } from "zod";
import {
  type EntityRelationDefinition,
  type EntityRelationDefinitionPage,
  relationDefinitionCreate,
  relationDefinitionDelete,
  relationDefinitionQuery,
  relationDefinitionUpdate,
} from "../../contracts/entity-relation.ts";
import type { Actor } from "../shared/actor.ts";
import { type RequestStore, runWrite } from "../shared/request.ts";
import { AppError, invalidInput, notFound } from "../shared/errors.ts";
export interface EntityRelationDefinitionStore extends RequestStore {
  list(input: z.infer<typeof relationDefinitionQuery>): Promise<EntityRelationDefinitionPage>;
  get(id: string): Promise<EntityRelationDefinition | null>;
  /** Owner relation lock must precede definition and endpoint kind locks. */
  lock(id: string): Promise<EntityRelationDefinition | null>;
  typesAvailable(ends: EntityRelationDefinition["ends"]): Promise<boolean>;
  assertCompatible(id: string, ends: EntityRelationDefinition["ends"]): Promise<void>;
  hasLinks(id: string): Promise<boolean>;
  create(ends: EntityRelationDefinition["ends"]): Promise<EntityRelationDefinition>;
  update(id: string, ends: EntityRelationDefinition["ends"], archived: boolean): Promise<EntityRelationDefinition>;
  delete(id: string): Promise<void>;
}
export interface RelationDefinitionEntry {
  access: "read" | "write";
  business?: boolean;
}
export interface EntityRelationDefinitionDeps {
  uow: {
    run<T>(
      actor: Actor,
      fn: (store: EntityRelationDefinitionStore) => Promise<T>,
      entry?: RelationDefinitionEntry,
    ): Promise<T>;
  };
}
function settingsWrite(d: EntityRelationDefinitionDeps): EntityRelationDefinitionDeps["uow"] {
  return { run: (actor, fn) => d.uow.run(actor, fn, { access: "write" }) };
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.safeParse(raw);
  if (!value.success) {
    throw invalidInput(
      "자료 관계 설정 입력을 확인하세요",
      value.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return value.data;
}
function version(current: EntityRelationDefinition, expected: number) {
  if (current.version !== expected) {
    throw new AppError("settings_changed", "관계 설정이 변경되었습니다. 최신 내용을 확인하세요");
  }
}
export function listEntityRelationDefinitions(d: EntityRelationDefinitionDeps, a: Actor, raw: unknown = {}) {
  const input = parse(relationDefinitionQuery, raw);
  return d.uow.run(a, (s) => s.list(input), { access: "read", business: input.purpose === "business" });
}
export function getEntityRelationDefinition(d: EntityRelationDefinitionDeps, a: Actor, id: string, purpose?: unknown) {
  purpose = parse(z.literal("business").optional(), purpose);
  id = parse(z.string().uuid(), id);
  return d.uow.run(a, async (s) => {
    const row = await s.get(id);
    if (!row) throw notFound();
    return row;
  }, { access: "read", business: purpose === "business" });
}
export function createEntityRelationDefinition(d: EntityRelationDefinitionDeps, a: Actor, raw: unknown) {
  const i = parse(relationDefinitionCreate, raw);
  return runWrite(settingsWrite(d), a, "entity-relation-definition.create", null, i, async (s) => {
    if (!await s.typesAvailable(i.ends)) throw invalidInput("활성 자료 종류를 선택하세요");
    return s.create(i.ends);
  });
}
export function updateEntityRelationDefinition(d: EntityRelationDefinitionDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(relationDefinitionUpdate, raw);
  return runWrite(settingsWrite(d), a, "entity-relation-definition.update", id, i, async (s) => {
    const old = await s.lock(id);
    if (!old) throw notFound();
    version(old, i.expected_version);
    const ends = i.ends ?? old.ends, archived = i.archived ?? old.archived;
    // Archiving or renaming a relation of an archived kind must remain possible.
    const changedKinds = ends.some((end, n) => end.type_id !== old.ends[n].type_id);
    if ((!archived && old.archived || changedKinds) && !await s.typesAvailable(ends)) {
      throw invalidInput("활성 자료 종류를 선택하세요");
    }
    await s.assertCompatible(id, ends);
    return s.update(id, ends, archived);
  });
}
export function deleteEntityRelationDefinition(d: EntityRelationDefinitionDeps, a: Actor, id: string, raw: unknown) {
  id = parse(z.string().uuid(), id);
  const i = parse(relationDefinitionDelete, raw);
  return runWrite(settingsWrite(d), a, "entity-relation-definition.delete", id, i, async (s) => {
    const old = await s.lock(id);
    if (!old) throw notFound();
    version(old, i.expected_version);
    if (await s.hasLinks(id)) throw invalidInput("연결이 있는 관계는 삭제할 수 없습니다. 보관하세요");
    await s.delete(id);
    return { deleted: true };
  });
}
