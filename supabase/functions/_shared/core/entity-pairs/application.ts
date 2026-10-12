import {
  ENTITY_PAIR_LIMIT,
  type EntityPairQuery,
  type EntityPairWrite,
  normalizePair,
} from "../../contracts/entity-pairs.ts";
import type { EntitySummary, EntityValues } from "../../contracts/entity.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import type { Actor } from "../shared/actor.ts";
import type { ChangeStore } from "../shared/changes.ts";
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { scopeOf } from "../shared/operations.ts";
import { runWrite } from "../shared/request.ts";

export interface EntityPairStore extends ChangeStore {
  endpoints(ids: string[], lock: boolean): Promise<EntityValues[]>;
  exists(left: string, right: string): Promise<boolean>;
  count(id: string): Promise<number>;
  change(left: string, right: string, linked: boolean): Promise<void>;
  list(id: string, limit: number, after?: string): Promise<EntitySummary[]>;
}
export interface EntityPairDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityPairStore) => Promise<T>): Promise<T> };
}
export function changeEntityPair(d: EntityPairDeps, a: Actor, id: string, input: EntityPairWrite, linked: boolean) {
  if (id === input.other_id) throw invalidInput("자기 자신은 연결할 수 없습니다");
  const normalized = normalizePair(id, input.other_id, input.expected_version, input.expected_other_version);
  const { entity_id, other_id, ...versions } = normalized;
  const { change_note, change_tag_ids } = input;
  return runWrite(d.uow, a, linked ? "entity.link" : "entity.unlink", { entity_id, other_id }, {
    ...versions,
    change_note,
    change_tag_ids,
  }, async (s) => {
    const endpoints = await s.endpoints([entity_id, other_id], true);
    if (endpoints.length !== 2) throw notFound();
    const left = endpoints.find((e) => e.id === entity_id)!, right = endpoints.find((e) => e.id === other_id)!;
    if (left.version !== versions.expected_version || right.version !== versions.expected_other_version) {
      throw conflict("연결 대상이 변경되었습니다. 양쪽 자료를 다시 조회하세요");
    }
    const exists = await s.exists(entity_id, other_id);
    const changed = exists !== linked;
    if (linked && (left.deleted_at || right.deleted_at || left.type.archived || right.type.archived)) {
      throw conflict("삭제·보관된 자료는 새로 연결할 수 없습니다");
    }
    if (changed) {
      if (linked && (await s.count(entity_id) >= ENTITY_PAIR_LIMIT || await s.count(other_id) >= ENTITY_PAIR_LIMIT)) {
        throw invalidInput(`자료당 연결은 ${ENTITY_PAIR_LIMIT}개까지 가능합니다`);
      }
      await s.change(entity_id, other_id, linked);
      const context = endpoints.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        schema_version: e.current_schema_version,
        captured_at: new Date().toISOString(),
        source: "selection" as const,
      }));
      await s.appendChange({
        target_kind: "entity",
        action: "update",
        target: {
          id: entity_id,
          title: `${left.title} ↔ ${right.title}`,
          entity_ids: [entity_id, other_id],
          entity_context: context,
        },
        before: { entity_ids: exists ? [entity_id, other_id] : [] },
        after: { entity_ids: linked ? [entity_id, other_id] : [] },
        change_note: change_note ?? `${left.title} ↔ ${right.title} 연결${linked ? "" : " 해제"}`,
        change_tag_ids,
      });
    }
    return {
      changed,
      pair: { entity_id, other_id },
      endpoint_versions: [
        { id: entity_id, version: versions.expected_version + Number(changed) },
        { id: other_id, version: versions.expected_other_version + Number(changed) },
      ],
    };
  });
}
export async function listEntityLinks(d: EntityPairDeps, a: Actor, id: string, q: EntityPairQuery) {
  const scope = await scopeOf(a, { list: "entity_links", id });
  let after: string | undefined;
  if (q.cursor) {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(q.cursor), (v) => v.charCodeAt(0))));
      if (decoded.scope !== scope || !entityReferenceId.safeParse(decoded.id).success) throw Error();
      after = decoded.id;
    } catch {
      throw invalidInput("커서가 잘못되었거나 다른 자료의 커서입니다");
    }
  }
  return d.uow.run(a, async (s) => {
    if (!(await s.endpoints([id], false)).length) throw notFound();
    const rows = await s.list(id, q.limit + 1, after), items = rows.slice(0, q.limit);
    const body = JSON.stringify({ scope, id: items.at(-1)?.id });
    return {
      items,
      next_cursor: rows.length > q.limit ? btoa(String.fromCharCode(...new TextEncoder().encode(body))) : null,
    };
  });
}
