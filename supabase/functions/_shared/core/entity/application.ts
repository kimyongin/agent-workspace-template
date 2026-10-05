import { id, isoDate, isoDateTime, text } from "../../contracts/common.ts";
import type { EntityCreate, EntityDetail, EntityQuery, EntityResult, EntityUpdate } from "../../contracts/entity.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { once, scopeOf } from "../shared/operations.ts";
import type { Keyset, RequestStore } from "../shared/store.ts";
import { changed, type ChangeStore } from "../shared/changes.ts";
import { basicChangeMemo } from "../shared/change-memo.ts";
import type { EntityChangePreview } from "../../contracts/entity-change.ts";
import type { ChangeMemo } from "../../contracts/change.ts";

export interface EntityStore extends RequestStore, ChangeStore {
  get(id: string, lock?: boolean): Promise<EntityResult | null>;
  related(id: string): Promise<Pick<EntityDetail, "tasks" | "records" | "principles">>;
  insert(input: Omit<EntityCreate, "request_id" | "change_memo">): Promise<EntityResult>;
  update(
    id: string,
    changes: Omit<EntityUpdate, "expected_version" | "change_note" | "change_memo" | "request_id">,
  ): Promise<EntityResult>;
  delete(id: string): Promise<void>;
  list(query: EntityQuery, after?: Keyset): Promise<EntityResult[]>;
}
export interface EntityDeps {
  uow: { run<T>(actor: Actor, fn: (store: EntityStore) => Promise<T>): Promise<T> };
}
export function createEntity(d: EntityDeps, a: Actor, i: EntityCreate) {
  return d.uow.run(a, (s) =>
    once(s, "create_entity", i.request_id, i, async () => {
      const { request_id: _r, change_note, change_memo, ...props } = i;
      const result = await s.insert(props);
      await s.appendChange({
        target_kind: "entity",
        action: "create",
        before: null,
        after: result,
        change_note,
        change_memo,
      });
      return result;
    }));
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
  if (entity.version !== expected) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
  return entity;
}
export function updateEntity(d: EntityDeps, a: Actor, id: string, i: EntityUpdate) {
  return d.uow.run(a, (s) =>
    once(s, `update_entity:${id}`, i.request_id, i, async () => {
      const old = await requireVersion(s, id, i.expected_version);
      const { expected_version: _v, change_note, change_memo, request_id: _r, ...props } = i;
      if (!changed(old, props)) return old;
      const result = await s.update(id, props);
      await s.appendChange({
        target_kind: "entity",
        action: "update",
        before: old,
        after: result,
        change_note,
        change_memo,
      });
      return result;
    }));
}
export function deleteEntity(
  d: EntityDeps,
  a: Actor,
  id: string,
  expected: number,
  change_note?: string,
  request_id?: string,
  change_memo?: ChangeMemo,
) {
  return d.uow.run(
    a,
    (s) =>
      once(s, `delete_entity:${id}`, request_id, { expected, change_note, change_memo }, async () => {
        const old = await requireVersion(s, id, expected);
        await s.delete(id);
        await s.appendChange({
          target_kind: "entity",
          action: "delete",
          before: old,
          after: null,
          change_note,
          change_memo,
        });
        return { deleted: true };
      }),
  );
}
export function previewEntityChange(d: EntityDeps, actor: Actor, input: EntityChangePreview) {
  return d.uow.run(actor, async (s) => {
    if (input.action === "create") {
      return { memo: basicChangeMemo({ action: "create", before: null, after: input.input }), changed: true };
    }
    const old = await requireVersion(s, input.id, input.input.expected_version);
    const values = Object.fromEntries(
      Object.entries(input.input).filter(([key]) =>
        !["expected_version", "change_note", "change_memo", "request_id"].includes(key)
      ),
    );
    const after = input.action === "delete" ? null : { ...old, ...values };
    return {
      memo: basicChangeMemo({ action: input.action, before: old, after }),
      changed: after === null || changed(old, values),
    };
  });
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
      if (decoded.scope !== scope || !id.safeParse(decoded.id).success || !validAt) throw Error();
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
