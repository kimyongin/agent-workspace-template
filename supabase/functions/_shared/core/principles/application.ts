import type {
  PrincipleCreate,
  PrincipleListQuery,
  PrincipleStatus,
  PrincipleUpdate,
} from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import { AppError, conflict, notFound } from "../shared/errors.ts";
import { decodeCursor, once, paginate, scopeOf, searchInputHash } from "../shared/operations.ts";
import type { PrincipleUnitOfWork } from "./ports.ts";

export interface PrincipleDeps {
  uow: PrincipleUnitOfWork;
}
export function createPrinciple(deps: PrincipleDeps, actor: Actor, input: PrincipleCreate) {
  return deps.uow.run(actor, (store) =>
    once(store, "create_principle", input.request_id, input, async () => {
      const { request_id: _request, ...content } = input;
      const principle = await store.insert(content);
      await store.enqueueIndex({ kind: "principle", id: principle.id, input_hash: await searchInputHash(principle) });
      return principle;
    }));
}
async function requirePrinciple(store: import("./ports.ts").PrincipleStore, id: string) {
  const p = await store.get(id, true);
  if (!p) throw notFound();
  return p;
}
function version(p: { version: number }, expected: number) {
  if (p.version !== expected) throw conflict("다른 변경이 저장되어 있습니다. 원문을 다시 확인하세요.");
}
export function updatePrinciple(deps: PrincipleDeps, actor: Actor, id: string, patch: PrincipleUpdate) {
  return deps.uow.run(actor, async (store) => {
    const old = await requirePrinciple(store, id);
    version(old, patch.expected_version);
    const { expected_version: _v, ...changes } = patch;
    const updated = await store.update(id, changes);
    if (old.title !== updated.title || old.summary !== updated.summary) {
      await store.enqueueIndex({ kind: "principle", id, input_hash: await searchInputHash(updated) });
    }
    return updated;
  });
}
export function setPrincipleStatus(deps: PrincipleDeps, actor: Actor, id: string, input: PrincipleStatus) {
  return deps.uow.run(actor, async (store) => {
    const old = await requirePrinciple(store, id);
    version(old, input.expected_version);
    const replacement = input.status === "active" ? null : input.replaced_by_id ?? old.replaced_by_id;
    if (replacement) {
      if (replacement === id || !await store.get(replacement)) {
        throw new AppError("invalid_reference", "대체 원칙이 없거나 접근할 수 없습니다");
      }
    }
    if (old.status === input.status && old.replaced_by_id === replacement) {
      throw conflict("이미 요청한 상태입니다");
    }
    return store.update(id, { status: input.status, replaced_by_id: replacement });
  });
}
export function deletePrinciple(deps: PrincipleDeps, actor: Actor, id: string, expected: number) {
  return deps.uow.run(actor, async (store) => {
    const p = await requirePrinciple(store, id);
    version(p, expected);
    await store.delete(id);
  });
}
export function getPrinciple(deps: PrincipleDeps, actor: Actor, id: string) {
  return deps.uow.run(actor, async (store) => {
    const item = await store.get(id);
    if (!item) throw notFound();
    return item;
  });
}
export async function listPrinciples(deps: PrincipleDeps, actor: Actor, query: PrincipleListQuery) {
  const scope = await scopeOf(actor, { list: "principles", status: query.status });
  const after = query.cursor ? decodeCursor(query.cursor, scope) : undefined;
  return deps.uow.run(actor, async (store) =>
    paginate(
      await store.list({ status: query.status, limit: query.limit + 1, after }),
      query.limit,
      (p) => p.updated_at,
      scope,
    ));
}
