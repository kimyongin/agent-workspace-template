import { entityChangeFacts, entityChangeTarget } from "./change.ts";
import { isoDate, isoDateTime, text } from "../../contracts/common.ts";
import {
  defaultEntityIdentitySettings,
  entityId,
  type EntityIdentitySettings,
  entityReferenceId,
  entitySourceGeneration,
  generateEntityExternalId,
  isActiveEntitySource,
} from "../../contracts/entity-identity.ts";
import type {
  EntityCreate,
  EntityDetail,
  EntityQuery,
  EntityRekey,
  EntityResult,
  EntityUpdate,
} from "../../contracts/entity.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { scopeOf } from "../shared/operations.ts";
import type { Keyset } from "../shared/store.ts";
import { changed, type ChangeStore } from "../shared/changes.ts";

export interface EntityStore extends ChangeStore {
  issueDataId?(): Promise<string>;
  getBusinessSettings(): Promise<{ settings: { entity_identity?: EntityIdentitySettings } }>;
  get(id: string, lock?: boolean): Promise<EntityResult | null>;
  related(id: string): Promise<Pick<EntityDetail, "tasks" | "records">>;
  insert(
    input: EntityCreate & {
      id: string;
      source: string;
      external_id: string;
      prop1: string;
      prop2: number | null;
      prop3: string | null;
      prop4: "a" | "b" | "c";
    },
  ): Promise<EntityResult>;
  update(
    id: string,
    changes: Omit<EntityUpdate, "expected_version" | "change_note" | "change_tag_ids">,
  ): Promise<EntityResult>;
  delete(id: string): Promise<void>;
  restore(id: string, changes: EntityCreate): Promise<EntityResult>;
  rekey(id: string, identity: { source: string; external_id: string }): Promise<EntityResult>;
  list(query: EntityQuery, after?: Keyset): Promise<EntityResult[]>;
}
export interface EntityDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityStore) => Promise<T>): Promise<T> };
}
/** Freeze generated identity before writing so an uncertain response can be retried with the exact tuple. */
export function prepareEntityRegistration(d: EntityDeps, a: Actor, i: Pick<EntityCreate, "source" | "external_id">) {
  return d.uow.run(a, async (s) => {
    const settings = (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings;
    const source = i.source ?? settings.default_source;
    if (!isActiveEntitySource(settings, source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
    if (!i.external_id && entitySourceGeneration(settings, source) === "manual") {
      throw invalidInput("식별자를 입력하세요");
    }
    const external_id = i.external_id ?? (s.issueDataId ? await s.issueDataId() : generateEntityExternalId()),
      id = entityId(source, external_id);
    const existing = await s.get(id);
    return {
      source,
      external_id,
      id,
      action: existing ? existing.deleted_at ? "restore" : "duplicate" : "create",
      expected_version: existing?.version,
      existing: existing ? { ...existing, ...await s.related(id) } : null,
    };
  });
}
export function createEntity(d: EntityDeps, a: Actor, i: EntityCreate) {
  return d.uow.run(a, async (s) => {
    const settings = (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings;
    const source = i.source ?? settings.default_source;
    if (!isActiveEntitySource(settings, source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
    if (!i.external_id) throw invalidInput("등록 준비로 식별자를 발급한 뒤 external_id를 고정하여 저장하세요");
    const external_id = i.external_id, id = entityId(source, external_id);
    const { change_note, change_tag_ids, expected_version, ...props } = i;
    const old = await s.get(id, true);
    if (old && !old.deleted_at) throw conflict("같은 발급처·식별자의 활성 엔터티가 있습니다");
    if (old && old.version !== expected_version) {
      throw conflict("삭제된 기존 엔터티를 조회하고 현재 버전으로 복원을 확인하세요");
    }
    if (!old && expected_version !== undefined) throw conflict("복원할 엔터티가 없습니다");
    if (!old && !props.prop1) throw invalidInput("속성 1은 필수입니다");
    const result = old ? await s.restore(id, props) : await s.insert({
      ...props,
      id,
      source,
      external_id,
      prop1: props.prop1!,
      prop2: props.prop2 ?? null,
      prop3: props.prop3 ?? null,
      prop4: props.prop4 ?? "a",
    });
    await s.appendChange({
      target_kind: "entity",
      target: entityChangeTarget(result),
      action: old ? "restore" : "create",
      before: old ? entityChangeFacts(old) : null,
      after: entityChangeFacts(result),
      change_note,
      change_tag_ids,
    });
    return result;
  });
}
export function getEntity(d: EntityDeps, a: Actor, id: string) {
  return d.uow.run(a, async (s) => {
    const entity = await s.get(id);
    if (!entity) throw notFound();
    return { ...entity, ...await s.related(id) };
  });
}
async function requireVersion(s: EntityStore, id: string, expected: number) {
  const entity = await s.get(id, true);
  if (!entity) throw notFound();
  if (entity.deleted_at) throw conflict("삭제된 엔터티입니다. 복원을 먼저 확인하세요");
  if (entity.version !== expected) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
  return entity;
}
export function rekeyEntity(d: EntityDeps, a: Actor, id: string, i: EntityRekey) {
  return d.uow.run(a, async (s) => {
    const old = await requireVersion(s, id, i.expected_version);
    const settings = (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings;
    if (!isActiveEntitySource(settings, i.source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
    const next = entityId(i.source, i.external_id);
    if (next === id) return old;
    if (await s.get(next, true)) {
      throw conflict("같은 발급처·식별자의 엔터티가 있습니다. 삭제된 대상도 별도 복원해야 합니다");
    }
    const result = await s.rekey(id, i);
    await s.appendChange({
      target_kind: "entity",
      target: entityChangeTarget(result),
      action: "update",
      before: entityChangeFacts(old),
      after: entityChangeFacts(result),
      change_note: i.change_note,
      change_tag_ids: i.change_tag_ids,
    });
    return result;
  });
}
export function updateEntity(d: EntityDeps, a: Actor, id: string, i: EntityUpdate) {
  return d.uow.run(a, async (s) => {
    const old = await requireVersion(s, id, i.expected_version);
    const { expected_version: _v, change_note, change_tag_ids, source, external_id, ...props } = i;
    const identity = { source: source ?? old.source, external_id: external_id ?? old.external_id };
    const next = entityId(identity.source, identity.external_id);
    if (next !== id) {
      const settings = (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings;
      if (!isActiveEntitySource(settings, identity.source)) throw invalidInput("삭제되지 않은 발급처를 선택하세요");
      if (await s.get(next, true)) {
        throw conflict("같은 발급처·식별자의 엔터티가 있습니다. 삭제된 대상도 별도 복원해야 합니다");
      }
    }
    if (next === id && !changed(old, props)) return old;
    let result = next === id ? old : await s.rekey(id, identity);
    if (changed(old, props)) result = await s.update(result.id, props);
    await s.appendChange({
      target_kind: "entity",
      target: entityChangeTarget(result),
      action: "update",
      before: entityChangeFacts(old),
      after: entityChangeFacts(result),
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
  return d.uow.run(
    a,
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
function sortValue(e: EntityResult, sort: EntityQuery["sort"]) {
  if (sort === "prop2") return String(e.prop2 ?? -1);
  if (sort === "prop3") return e.prop3 ?? "0000-01-01";
  return e[sort];
}
export async function listEntities(d: EntityDeps, a: Actor, q: EntityQuery) {
  const { cursor, limit, ...filter } = q;
  const scope = await scopeOf(a, { list: "entities", ...filter });
  let after: Keyset | undefined;
  if (cursor) {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor), (v) => v.charCodeAt(0))));
      const validAt = typeof decoded.at === "string" &&
        (q.sort === "updated_at"
          ? isoDateTime.safeParse(decoded.at).success
          : q.sort === "prop2"
          ? /^-?\d{1,7}$/.test(decoded.at) && Number(decoded.at) >= -1 && Number(decoded.at) <= 1_000_000
          : q.sort === "prop3"
          ? decoded.at === "0000-01-01" || isoDate.safeParse(decoded.at).success
          : text(1, 100).safeParse(decoded.at).success);
      if (decoded.scope !== scope || !entityReferenceId.safeParse(decoded.id).success || !validAt) throw Error();
      after = { at: decoded.at, id: decoded.id };
    } catch {
      throw invalidInput("커서가 잘못되었거나 다른 목록 조건의 커서입니다");
    }
  }
  return d.uow.run(a, async (s) => {
    const rows = await s.list({ ...q, limit: limit + 1 }, after);
    const items = rows.slice(0, limit), last = items.at(-1);
    const body = last ? JSON.stringify({ scope, at: sortValue(last, q.sort), id: last.id }) : "";
    return {
      items,
      next_cursor: rows.length > limit ? btoa(String.fromCharCode(...new TextEncoder().encode(body))) : null,
    };
  });
}
