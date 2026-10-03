import type { PrincipleCreate, PrincipleListQuery } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import { notFound } from "../shared/errors.ts";
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
