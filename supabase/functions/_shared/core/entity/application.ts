import { runWrite } from "../shared/request.ts";
import { entityChangeFacts, entityChangeTarget } from "./change.ts";
import { entityUpdateDecision, registrationContent, registrationIdentity, registrationState } from "./domain.ts";
import { isoDate, isoDateTime, text } from "../../contracts/common.ts";
import {
  defaultEntityIdentitySettings,
  entityId,
  type EntityIdentitySettings,
  entityReferenceId,
  entitySourceGeneration,
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
import { AppError, conflict, invalidInput, notFound } from "../shared/errors.ts";
import { scopeOf } from "../shared/operations.ts";
import type { Keyset } from "../shared/store.ts";
import { type ChangeStore } from "../shared/changes.ts";

export interface EntityStore extends ChangeStore {
  issueDataId?(): Promise<string>;
  getBusinessSettings(lockIdentity?: boolean): Promise<
    { versions?: { entity_identity: number }; settings: { entity_identity?: EntityIdentitySettings } }
  >;
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
/** Read-only preparation freezes issuer, mode and settings revision, never reserves an ID. */
export function prepareEntityRegistration(d: EntityDeps, a: Actor, i: Pick<EntityCreate, "source" | "external_id">) {
  return d.uow.run(a, async (s) => {
    const saved = await s.getBusinessSettings();
    const settings = saved.settings.entity_identity ?? defaultEntityIdentitySettings;
    const { source, external_id } = registrationIdentity(settings, i);
    const id = external_id === undefined ? undefined : entityId(source, external_id);
    const existing = id === undefined ? null : await s.get(id);
    return {
      source,
      generation: entitySourceGeneration(settings, source),
      settings_version: saved.versions?.entity_identity ?? 0,
      external_id,
      id,
      action: registrationState(existing),
      expected_version: existing?.version,
      existing: existing && id ? { ...existing, ...await s.related(id) } : null,
    };
  });
}
export function createEntity(d: EntityDeps, a: Actor, i: EntityCreate) {
  return runWrite(
    d.uow,
    a,
    i.expected_version === undefined ? "entity.create" : "entity.restore",
    null,
    i,
    async (s) => {
      const saved = await s.getBusinessSettings(true);
      if (i.settings_version !== undefined && i.settings_version !== (saved.versions?.entity_identity ?? 0)) {
        throw new AppError("settings_changed", "발급처 설정이 변경되었습니다. 다시 준비하세요");
      }
      const settings = saved.settings.entity_identity ?? defaultEntityIdentitySettings;
      const { source } = registrationIdentity(settings, i);
      if (i.expected_version !== undefined && i.external_id === undefined) {
        throw invalidInput(
          "복원할 외부 식별자가 필요합니다",
        );
      }
      let external_id = i.external_id;
      if (external_id === undefined) {
        if (!s.issueDataId) throw invalidInput("ID 발급 저장소가 필요합니다");
        do {
          external_id = await s.issueDataId();
        } while (await s.get(entityId(source, external_id), true));
      }
      const id = entityId(source, external_id);
      const { change_note, change_tag_ids, expected_version, settings_version: _settings, ...props } = i;
      const old = await s.get(id, true);
      const registration = registrationState(old);
      if (registration === "duplicate") throw conflict("같은 발급처·식별자의 활성 엔터티가 있습니다");
      if (old && old.version !== expected_version) {
        throw conflict("삭제된 기존 엔터티를 조회하고 현재 버전으로 복원을 확인하세요");
      }
      if (!old && expected_version !== undefined) throw conflict("복원할 엔터티가 없습니다");
      const content = registrationContent(props, { source, external_id }, old ? entityChangeFacts(old) : null);
      const result = old ? await s.restore(id, props) : await s.insert({ ...props, ...content, id });
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
    },
  );
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
  return runWrite(d.uow, a, "entity.rekey", id, i, async (s) => {
    const old = await requireVersion(s, id, i.expected_version);
    const settings = (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings;
    const decision = entityUpdateDecision(settings, { id, facts: entityChangeFacts(old) }, i, true);
    if (!decision.rekey) return old;
    if (await s.get(decision.id, true)) {
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
  return runWrite(d.uow, a, "entity.update", id, i, async (s) => {
    const old = await requireVersion(s, id, i.expected_version);
    const { expected_version: _v, change_note, change_tag_ids, ...input } = i;
    // Ordinary property edits on retired issuers do not require settings or a rekey.
    const settings = (input.source !== undefined && input.source !== old.source) ||
        (input.external_id !== undefined && input.external_id !== old.external_id)
      ? (await s.getBusinessSettings()).settings.entity_identity ?? defaultEntityIdentitySettings
      : defaultEntityIdentitySettings;
    const decision = entityUpdateDecision(settings, { id, facts: entityChangeFacts(old) }, input);
    if (decision.rekey && await s.get(decision.id, true)) {
      throw conflict("같은 발급처·식별자의 엔터티가 있습니다. 삭제된 대상도 별도 복원해야 합니다");
    }
    if (!decision.rekey && !decision.contentChanged) return old;
    let result = decision.rekey ? await s.rekey(id, decision.identity) : old;
    if (decision.contentChanged) result = await s.update(result.id, decision.properties);
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
  return runWrite(
    d.uow,
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
