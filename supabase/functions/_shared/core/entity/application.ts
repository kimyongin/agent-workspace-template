import { runWrite } from "../shared/request.ts";
import { entityChangeFacts, entityChangeTarget } from "./change.ts";
import { isoDateTime, text } from "../../contracts/common.ts";
import { checkedProperties, type EntityDefinitions, requireDefinition } from "./values.ts";
import { entityReferenceId, entityTypeKey } from "../../contracts/entity-identity.ts";
import {
  decodeIdentifierValue,
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../contracts/entity-identifiers.ts";
import type {
  EntityCreate,
  EntityDetail,
  EntityQuery,
  EntityRestore,
  EntitySummary,
  EntityUpdate,
  EntityValues,
} from "../../contracts/entity.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, conflict, invalidInput, notFound } from "../shared/errors.ts";
import { scopeOf } from "../shared/operations.ts";
import { type EntityKeyset, validateEntityQuery, validFilterScalar } from "./list-rules.ts";
import { changed, type ChangeStore } from "../shared/changes.ts";

export interface EntityStore extends ChangeStore, EntityDefinitions {
  issueDataId?(): Promise<string>;
  get(id: string, lock?: boolean): Promise<EntityValues | null>;
  related(id: string): Promise<Pick<EntityDetail, "tasks" | "records">>;
  insert(
    input: EntityCreate & {
      id: string;
    },
    generatedIdentity?: boolean,
  ): Promise<EntityValues>;
  update(
    id: string,
    changes: Omit<EntityUpdate, "expected_version" | "change_note" | "change_tag_ids">,
  ): Promise<EntityValues>;
  delete(id: string): Promise<void>;
  restore(id: string, changes: EntityRestore): Promise<EntityValues>;
  listRevisions?(typeId?: string): Promise<Array<{ id: string; type_version: number; schema_version: number }>>;
  list(
    query: EntityQuery,
    after?: EntityKeyset,
    typeIds?: string[],
  ): Promise<Array<EntitySummary & { _cursor?: EntityKeyset }>>;
}
export interface EntityEntry {
  access: "read" | "write";
  typeId?: string;
  entityId?: string;
}
export interface EntityDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityStore) => Promise<T>, entry?: EntityEntry): Promise<T> };
}
export function createEntity(d: EntityDeps, a: Actor, i: EntityCreate) {
  i = { ...i, entity_type_id: entityTypeKey.parse(i.entity_type_id) };
  return runWrite(
    entityWork(d, { access: "write", typeId: i.entity_type_id }),
    a,
    "entity.create",
    null,
    i,
    (s) => createEntityInTransaction(s, i),
  );
}
/** Resolve explicit generation commands only within the write transaction. */
async function identifierProperties(
  s: EntityStore,
  definition: Awaited<ReturnType<typeof requireDefinition>>,
  properties: EntityValues["properties"],
  intents: Record<string, string> = {},
  creation = false,
  previous: EntityValues["properties"] = {},
) {
  const selected = definition.schema["x-identity-property"];
  if (!selected) throw invalidInput("자료 식별자 항목이 필요합니다");
  const values = { ...properties }, commands = { ...intents };
  const kinds = definition.identifier_kinds ?? [];
  const settings = definition.schema.properties[selected]?.["x-identifier"];
  if (
    creation && values[selected] === undefined && commands[selected] === undefined && settings &&
    kinds.find((k) => k.id === settings.default_kind_id)?.generation === "automatic"
  ) {
    commands[selected] = settings.default_kind_id;
  }
  for (const [key, kindId] of Object.entries(commands)) {
    const property = definition.schema.properties[key];
    const field = property?.["x-identifier"];
    const kind = kinds.find((k) => k.id === kindId);
    if (
      (!creation && key === selected) || property?.readOnly || property?.deprecated || properties[key] !== undefined ||
      !field?.allowed_kind_ids.includes(kindId) ||
      !kind?.active || kind.generation !== "automatic"
    ) {
      throw invalidInput("자동 발급 요청을 확인하세요", [{
        path: `generate_identifiers.${key}`,
        message: "활성 자동 발급 종류를 선택하고 기존 값은 함께 보내지 마세요",
      }]);
    }
    if (!s.issueDataId) throw invalidInput("ID 발급 저장소가 필요합니다");
    values[key] = encodeIdentifierValue(kindId, await s.issueDataId());
  }
  for (const [key, field] of Object.entries(definition.schema.properties)) {
    if (!field["x-identifier"] || values[key] == null) continue;
    if (!creation && key === selected && values[key] !== previous[key]) {
      throw invalidInput("자료 식별자는 변경할 수 없습니다");
    }
    let pair;
    try {
      pair = decodeIdentifierValue(String(values[key]));
    } catch {
      throw invalidInput("식별자 종류와 원본 값을 확인하세요", [{
        path: `properties.${key}`,
        message: "완전한 식별자 값이 필요합니다",
      }]);
    }
    if (
      !field["x-identifier"].allowed_kind_ids.includes(pair.kind_id) ||
      ((creation || previous[key] !== values[key]) && !kinds.find((k) => k.id === pair.kind_id)?.active)
    ) {
      throw invalidInput("현재 허용된 활성 식별자 종류를 선택하세요", [{
        path: `properties.${key}`,
        message: "식별자 종류를 확인하세요",
      }]);
    }
  }
  return { properties: values, generated: commands[selected] !== undefined };
}
export async function createEntityInTransaction(s: EntityStore, i: EntityCreate): Promise<EntityValues> {
  const definition = await requireDefinition(s, i.entity_type_id, i.schema_version, true);
  const resolved = await identifierProperties(s, definition, i.properties, i.generate_identifiers, true);
  const properties = checkedProperties(definition, resolved.properties, i.properties, true);
  const pair = decodeIdentifierValue(String(properties[definition.schema["x-identity-property"]!]));
  const id = encodeIdentifierReference(i.entity_type_id, pair.kind_id, pair.raw);
  if (!resolved.generated && await s.get(id)) {
    throw conflict("같은 식별자의 자료가 있습니다. 삭제 자료는 명시 복원하세요");
  }
  const { change_note, change_tag_ids, generate_identifiers: _g, ...input } = i;
  const result = await s.insert({ ...input, id, properties }, resolved.generated);
  await s.appendChange({
    target_kind: "entity",
    target: entityChangeTarget(result),
    action: "create",
    before: null,
    after: {
      ...entityChangeFacts(result),
      property_labels: Object.fromEntries(
        Object.entries(definition.schema.properties).map(([key, field]) => [key, field.title ?? key]),
      ),
    },
    change_note,
    change_tag_ids,
  });
  return result;
}
export function lookupEntity(d: EntityDeps, a: Actor, typeId: string, identifier: string) {
  const pair = decodeIdentifierValue(identifier);
  const id = encodeIdentifierReference(typeId, pair.kind_id, pair.raw);
  return d.uow.run(a, (s) => s.get(id), { access: "read", typeId });
}
export function restoreEntity(d: EntityDeps, a: Actor, id: string, i: EntityRestore) {
  return runWrite(entityWork(d, { access: "write", entityId: id }), a, "entity.restore", id, i, (s) => {
    return restoreEntityInTransaction(s, id, i);
  });
}
export async function restoreEntityInTransaction(s: EntityStore, id: string, i: EntityRestore) {
  const old = await s.get(id, true);
  if (!old) throw notFound();
  if (!old.deleted_at || old.version !== i.expected_version) {
    throw conflict("삭제 자료의 현재 버전으로 복원을 확인하세요");
  }
  const definition = await requireDefinition(s, old.entity_type_id, i.schema_version, true);
  const resolved = await identifierProperties(
    s,
    definition,
    { ...old.properties, ...i.properties },
    {},
    false,
    old.properties,
  );
  const properties = checkedProperties(definition, resolved.properties, i.properties ?? {}, false, old.properties);
  const result = await s.restore(id, { ...i, properties });
  await s.appendChange({
    target_kind: "entity",
    target: entityChangeTarget(result),
    action: "restore",
    before: entityChangeFacts(old),
    after: entityChangeFacts(result),
    change_note: i.change_note,
    change_tag_ids: i.change_tag_ids,
  });
  return result;
}

export function getEntity(d: EntityDeps, a: Actor, id: string) {
  return d.uow.run(a, async (s) => {
    const entity = await s.get(id);
    if (!entity) throw notFound();
    return { ...entity, ...await s.related(id) };
  }, { access: "read", entityId: id });
}
async function requireVersion(s: EntityStore, id: string, expected: number) {
  const entity = await s.get(id, true);
  if (!entity) throw notFound();
  if (entity.deleted_at) throw conflict("삭제된 엔터티입니다. 복원을 먼저 확인하세요");
  if (entity.version !== expected) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
  return entity;
}
export function updateEntity(d: EntityDeps, a: Actor, id: string, i: EntityUpdate) {
  return runWrite(entityWork(d, { access: "write", entityId: id }), a, "entity.update", id, i, async (s) => {
    assertImmutableType(i);
    const old = await requireVersion(s, id, i.expected_version);
    const definition = await requireDefinition(s, old.entity_type_id, i.schema_version);
    const { expected_version: _v, change_note, change_tag_ids, ...input } = i;
    const { generate_identifiers, ...changes } = input;
    // Explicit generation replaces an ordinary value; omitted values otherwise remain unchanged.
    const supplied = { ...old.properties, ...input.properties };
    for (const key of Object.keys(generate_identifiers ?? {})) {
      if (input.properties?.[key] !== undefined) throw invalidInput("값과 자동 발급 요청을 함께 보낼 수 없습니다");
      delete supplied[key];
    }
    const resolved = await identifierProperties(s, definition, supplied, generate_identifiers, false, old.properties);
    const finalProperties = checkedProperties(
      definition,
      resolved.properties,
      input.properties ?? {},
      false,
      old.properties,
    );
    const patch = { ...changes, properties: finalProperties };
    if (!changed(entityChangeFacts(old), patch)) return old;
    const result = await s.update(id, patch);
    await s.appendChange({
      target_kind: "entity",
      target: entityChangeTarget(result),
      action: "update",
      before: entityChangeFacts(old),
      after: {
        ...entityChangeFacts(result),
        property_labels: Object.fromEntries(
          Object.entries(definition.schema.properties).map(([key, field]) => [key, field.title ?? key]),
        ),
      },
      change_note,
      change_tag_ids,
    });
    return result;
  });
}
export function deleteEntity(
  d: EntityDeps,
  a: Actor,
  id: string,
  expected: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  return runWrite(
    entityWork(d, { access: "write", entityId: id }),
    a,
    "entity.delete",
    id,
    { expected_version: expected, change_note, change_tag_ids },
    async (s) => {
      const old = await requireVersion(s, id, expected);
      await s.delete(id);
      await s.appendChange({
        target_kind: "entity",
        target: entityChangeTarget(old),
        action: "delete",
        before: entityChangeFacts(old),
        after: null,
        change_note,
        change_tag_ids,
      });
      return { deleted: true };
    },
  );
}
export function assertImmutableType(input: unknown) {
  if (
    input && typeof input === "object" && ["entity_type_id", "source", "external_id", "id"].some((key) => key in input)
  ) {
    throw new AppError("entity_type_immutable", "자료 종류·발급처·번호는 변경할 수 없습니다", [{
      path: "entity_type_id",
      message: "자료 종류는 생성 후 변경할 수 없습니다",
    }]);
  }
}
export function listEntities(d: EntityDeps, a: Actor, q: EntityQuery) {
  return d.uow.run(a, async (s) => {
    const revisions = await s.listRevisions?.(q.entity_type_id) ?? [];
    const definition = q.entity_type_id ? await s.definition(q.entity_type_id) : null;
    validateEntityQuery(q, definition);
    const { cursor, limit, ...filter } = q;
    const scope = await scopeOf(a, { list: "entities", workspace_id: a.workspaceId, ...filter, revisions });
    if (q.entity_type_id && !definition) {
      if (cursor) throw invalidInput("커서의 자료 종류를 찾을 수 없습니다");
      throw notFound();
    }
    let after: EntityKeyset | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor), (v) => v.charCodeAt(0))));
        const property = typeof q.sort === "object" ? definition?.schema.properties[q.sort.key] : null;
        const validAt = property
          ? decoded.category === 2 ? validFilterScalar(property, decoded.at) : decoded.at === null
          : decoded.category === 2 && typeof decoded.at === "string" &&
            (q.sort === "updated_at"
              ? isoDateTime.safeParse(decoded.at).success
              : text(1, 4096).safeParse(decoded.at).success);
        if (
          decoded.scope !== scope || !entityReferenceId.safeParse(decoded.id).success ||
          ![0, 1, 2].includes(decoded.category) || !validAt
        ) throw Error();
        after = { at: decoded.at, category: decoded.category, id: decoded.id };
      } catch {
        throw invalidInput("커서가 잘못되었거나 다른 목록 조건·정의의 커서입니다");
      }
    }
    const rows = await s.list(
      { ...q, limit: limit + 1 },
      after,
      s.listRevisions ? revisions.map((type) => type.id) : undefined,
    );
    const selected = rows.slice(0, limit), last = selected.at(-1);
    const tuple = last
      ? last._cursor ?? { at: last[q.sort as "title" | "updated_at"], category: 2, id: last.id }
      : null;
    const body = JSON.stringify({ scope, ...tuple });
    return {
      items: selected.map(({ _cursor: _private, ...item }) => item),
      next_cursor: rows.length > limit ? btoa(String.fromCharCode(...new TextEncoder().encode(body))) : null,
    };
  }, { access: "read", typeId: q.entity_type_id });
}

function entityWork(d: EntityDeps, entry: EntityEntry): EntityDeps["uow"] {
  return { run: (actor, fn) => d.uow.run(actor, fn, entry) };
}
