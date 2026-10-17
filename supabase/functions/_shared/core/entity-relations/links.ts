import { z } from "zod";
import {
  type RelationLinkQuery,
  relationLinkQuery,
  type RelationLinkWrite,
  relationLinkWrite,
  type RelationMutationResult,
  type RelationReplaceWrite,
  relationReplaceWrite,
} from "../../contracts/entity-relation-links.ts";
import type { EntityRelationDefinition } from "../../contracts/entity-relation.ts";
import type { EntitySummary, EntityValues } from "../../contracts/entity.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import type { Actor } from "../shared/actor.ts";
import type { ChangeStore } from "../shared/changes.ts";
import { runWrite } from "../shared/request.ts";
import { scopeOf } from "../shared/operations.ts";
import { AppError, conflict, invalidInput, notFound } from "../shared/errors.ts";
export interface EntityRelationLinkStore extends ChangeStore {
  definition(id: string, lock: boolean): Promise<EntityRelationDefinition | null>;
  endpoints(ids: string[], lock: boolean): Promise<EntityValues[]>;
  linkedIds(definition: string, side: 0 | 1, origin: string): Promise<string[]>;
  exists(definition: string, left: string, right: string): Promise<boolean>;
  count(definition: string, side: 0 | 1, origin: string): Promise<number>;
  apply(
    definition: string,
    side: 0 | 1,
    origin: string,
    other: string,
    linked: boolean,
    previous: string | null,
  ): Promise<void>;
  list(q: RelationLinkQuery, after: string | undefined, candidates: boolean): Promise<EntitySummary[]>;
}
export interface EntityRelationLinkDeps {
  uow: {
    run<T>(actor: Actor, fn: (s: EntityRelationLinkStore) => Promise<T>): Promise<T>;
    read<T>(actor: Actor, fn: (s: EntityRelationLinkStore) => Promise<T>): Promise<T>;
  };
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidInput(
      "관계 연결 입력을 확인하세요",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
function requireKind(def: EntityRelationDefinition, side: 0 | 1, origin: EntityValues) {
  if (origin.entity_type_id !== def.ends[side].type_id) {
    throw invalidInput("관계의 해당 방향과 자료 종류가 맞지 않습니다");
  }
}
function active(def: EntityRelationDefinition, ...values: EntityValues[]) {
  if (def.archived || values.some((v) => v.deleted_at || v.type.archived)) {
    throw conflict("보관·삭제된 정의나 자료에는 새로 연결할 수 없습니다");
  }
}
/** Reused by create-and-link inside the SAME transaction and outer request receipt. */
export async function mutateRelationInTransaction(
  s: EntityRelationLinkStore,
  i: RelationLinkWrite | RelationReplaceWrite,
  mode: "connect" | "unlink" | "replace",
): Promise<RelationMutationResult> {
  if (i.origin_id === i.other_id) throw invalidInput("자기 자신은 연결할 수 없습니다");
  const def = await s.definition(i.definition_id, true);
  if (!def) throw notFound();
  if (def.version !== i.expected_definition_version) {
    throw new AppError("settings_changed", "관계 정의가 변경되었습니다. 최신 설정을 확인하세요");
  }
  const replacement = mode === "replace" ? i as RelationReplaceWrite : null;
  if (replacement && def.ends[i.side].cardinality !== "one") throw invalidInput("단일 관계만 교체할 수 있습니다");
  const current = replacement ? await s.linkedIds(def.id, i.side, i.origin_id) : [];
  if (replacement && (current.length > 1 || (current[0] ?? null) !== replacement.previous_other_id)) {
    throw conflict("기존 연결이 변경되었습니다. 현재 값을 확인하세요");
  }
  const ids = [
    ...new Set([i.origin_id, i.other_id, ...(replacement?.previous_other_id ? [replacement.previous_other_id] : [])]),
  ];
  const values = await s.endpoints(ids, true);
  if (values.length !== ids.length) throw notFound();
  const origin = values.find((e) => e.id === i.origin_id)!, other = values.find((e) => e.id === i.other_id)!;
  requireKind(def, i.side, origin);
  requireKind(def, i.side === 0 ? 1 : 0, other);
  if (
    origin.version !== i.expected_version || other.version !== i.expected_other_version ||
    replacement?.previous_other_id &&
      values.find((e) => e.id === replacement.previous_other_id)!.version !== replacement.expected_previous_version
  ) throw conflict("연결 대상이 변경되었습니다. 양쪽 자료를 다시 조회하세요");
  if (mode !== "unlink") active(def, origin, other);
  const [left, right] = i.side === 0 ? [origin.id, other.id] : [other.id, origin.id];
  const exists = await s.exists(def.id, left, right),
    changed = mode === "replace" ? replacement!.previous_other_id !== i.other_id : exists !== (mode === "connect");
  if (changed) {
    if (mode !== "unlink") {
      if (!replacement && def.ends[i.side].cardinality === "one" && await s.count(def.id, i.side, origin.id) > 0) {
        throw conflict("이 자료의 단일 관계가 이미 연결되어 있습니다. 교체하세요");
      }
      const opposite = i.side === 0 ? 1 : 0;
      if (def.ends[opposite].cardinality === "one" && await s.count(def.id, opposite, other.id) > 0) {
        throw conflict("상대 자료의 단일 관계가 다른 자료에 연결되어 있습니다");
      }
    }
    await s.apply(def.id, i.side, origin.id, other.id, mode !== "unlink", replacement?.previous_other_id ?? null);
    const captured_at = new Date().toISOString();
    await s.appendChange({
      target_kind: "entity",
      action: "update",
      target: {
        id: origin.id,
        title: `${def.ends[i.side].label}: ${origin.title} ↔ ${other.title}`,
        entity_ids: ids,
        entity_context: values.map((e) => ({
          id: e.id,
          title: e.title,
          type: e.type,
          schema_version: e.current_schema_version,
          captured_at,
          source: "selection" as const,
        })),
      },
      before: {
        entity_ids: mode === "replace"
          ? replacement!.previous_other_id ? [origin.id, replacement!.previous_other_id] : []
          : exists
          ? [origin.id, other.id]
          : [],
      },
      after: { entity_ids: mode === "unlink" ? [] : [origin.id, other.id] },
      change_note: i.change_note ??
        `${def.ends[i.side].label}: ${origin.title} ↔ ${other.title} ${
          mode === "unlink" ? "연결 해제" : mode === "replace" ? "연결 교체" : "연결"
        }`,
      change_tag_ids: i.change_tag_ids,
    });
  }
  return {
    changed,
    definition_id: def.id,
    side: i.side,
    origin_id: origin.id,
    other_id: other.id,
    endpoint_versions: values.map((e) => ({ id: e.id, version: e.version + Number(changed) })),
  };
}
function write(d: EntityRelationLinkDeps, a: Actor, raw: unknown, mode: "connect" | "unlink" | "replace") {
  const i = mode === "replace" ? parse(relationReplaceWrite, raw) : parse(relationLinkWrite, raw);
  if (i.origin_id === i.other_id) return Promise.reject(invalidInput("자기 자신은 연결할 수 없습니다"));
  return runWrite(
    d.uow,
    a,
    `entity-relation.${mode}`,
    { definition_id: i.definition_id, side: i.side, origin_id: i.origin_id },
    i,
    (s) => mutateRelationInTransaction(s, i, mode),
  );
}
export const connectEntityRelation = (d: EntityRelationLinkDeps, a: Actor, raw: unknown) => write(d, a, raw, "connect");
export const unlinkEntityRelation = (d: EntityRelationLinkDeps, a: Actor, raw: unknown) => write(d, a, raw, "unlink");
export const replaceEntityRelation = (d: EntityRelationLinkDeps, a: Actor, raw: unknown) => write(d, a, raw, "replace");
export async function listEntityRelationLinks(d: EntityRelationLinkDeps, a: Actor, raw: unknown, candidates = false) {
  const i = parse(relationLinkQuery, raw),
    scope = await scopeOf(a, {
      list: candidates ? "typed-candidates" : "typed-links",
      definition_id: i.definition_id,
      side: i.side,
      origin_id: i.origin_id,
      q: i.q,
    });
  let after: string | undefined;
  if (i.cursor) {
    try {
      const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(i.cursor), (v) => v.charCodeAt(0))));
      if (body.scope !== scope || !entityReferenceId.safeParse(body.id).success) throw Error();
      after = body.id;
    } catch {
      throw invalidInput("다른 자료·관계·검색 조건의 커서입니다");
    }
  }
  return d.uow.read(a, async (s) => {
    const def = await s.definition(i.definition_id, false);
    if (!def) throw notFound();
    const [origin] = await s.endpoints([i.origin_id], false);
    if (!origin) throw notFound();
    requireKind(def, i.side, origin);
    if (candidates) active(def, origin);
    const rows = await s.list(i, after, candidates),
      items = rows.slice(0, i.limit),
      body = JSON.stringify({ scope, id: items.at(-1)?.id });
    return {
      definition: def,
      side: i.side,
      origin_id: origin.id,
      items,
      next_cursor: rows.length > i.limit ? btoa(String.fromCharCode(...new TextEncoder().encode(body))) : null,
    };
  });
}
