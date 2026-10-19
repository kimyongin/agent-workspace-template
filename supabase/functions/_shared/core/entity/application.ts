import { runWrite } from "../shared/request.ts";
import { entityChangeFacts, entityChangeTarget } from "./change.ts";
import { registrationContent, registrationIdentity, registrationState } from "./domain.ts";
import { isoDateTime, text } from "../../contracts/common.ts";
import { checkedProperties, type EntityDefinitions, requireDefinition } from "./values.ts";
import { entityId, entityReferenceId, entityTypeKey } from "../../contracts/entity-identity.ts";
import type { EntityTypeIdentity } from "../../contracts/entity-issuer.ts";
import type {
  EntityCreate,
  EntityDetail,
  EntityQuery,
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
  getTypeIdentity(typeId: string, lock?: boolean): Promise<EntityTypeIdentity | null>;
  get(id: string, lock?: boolean): Promise<EntityValues | null>;
  related(id: string): Promise<Pick<EntityDetail, "tasks" | "records">>;
  insert(
    input: EntityCreate & {
      id: string;
      source: string;
      external_id: string;
    },
    generatedIdentity?: boolean,
  ): Promise<EntityValues>;
  update(
    id: string,
    changes: Omit<EntityUpdate, "expected_version" | "change_note" | "change_tag_ids">,
  ): Promise<EntityValues>;
  delete(id: string): Promise<void>;
  restore(id: string, changes: EntityCreate): Promise<EntityValues>;
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
    i.expected_version === undefined ? "entity.create" : "entity.restore",
    null,
    i,
    (s) => createEntityInTransaction(s, i),
  );
}
/** Store-level creation/restoration command; caller owns the transaction and single request receipt. */
export async function createEntityInTransaction(s: EntityStore, i: EntityCreate): Promise<EntityValues> {
  const definition = await requireDefinition(s, i.entity_type_id, i.schema_version, true);
  const settings = await s.getTypeIdentity(i.entity_type_id, true);
  if (!settings) throw notFound();
  if (i.identity_version !== undefined && i.identity_version !== settings.version) {
    throw new AppError("settings_changed", "발급처 설정이 변경되었습니다. 설정을 다시 조회하세요");
  }
  const { source } = registrationIdentity(settings, i);
  if (i.expected_version !== undefined && i.external_id === undefined) {
    throw invalidInput(
      "복원할 외부 식별자가 필요합니다",
    );
  }
  let external_id = i.external_id;
  if (external_id === undefined) {
    if (!s.issueDataId) throw invalidInput("ID 발급 저장소가 필요합니다");
    external_id = await s.issueDataId();
  }
  const id = entityId(source, i.entity_type_id, external_id);
  const { change_note, change_tag_ids, expected_version, identity_version: _settings, ...props } = i;
  const generated = i.external_id === undefined;
  const snapshot = generated ? null : await s.get(id);
  if (snapshot && snapshot.entity_type_id !== i.entity_type_id) {
    throw new AppError("entity_type_immutable", "같은 식별자의 자료 종류는 변경할 수 없습니다", [{
      path: "entity_type_id",
      message: "원래 자료 종류로 복원하세요",
    }]);
  }
  const old = snapshot ? await s.get(id, true) : null;
  const registration = registrationState(old);
  if (registration === "duplicate") throw conflict("같은 발급처·식별자의 활성 엔터티가 있습니다");
  if (old && old.version !== expected_version) {
    throw conflict("삭제된 기존 엔터티를 조회하고 현재 버전으로 복원을 확인하세요");
  }
  if (!old && expected_version !== undefined) throw conflict("복원할 엔터티가 없습니다");
  const content = registrationContent(props, { source, external_id }, old ? entityChangeFacts(old) : null);
  content.properties = checkedProperties(definition, content.properties, props.properties, !old, old?.properties);
  const result = old
    ? await s.restore(id, { ...props, ...content })
    : await s.insert({ ...props, ...content, id }, generated);
  await s.appendChange({
    target_kind: "entity",
    target: entityChangeTarget(result),
    action: old ? "restore" : "create",
    before: old ? entityChangeFacts(old) : null,
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
    const finalProperties = checkedProperties(
      definition,
      { ...old.properties, ...input.properties },
      input.properties ?? {},
      false,
      old.properties,
    );
    const patch = { ...input, ...(input.properties === undefined ? {} : { properties: finalProperties }) };
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
