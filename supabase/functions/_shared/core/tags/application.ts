import type { z } from "zod";
import type { tagCreate, tagListQuery, tagRename, TagResult } from "../../contracts/tag.ts";
import type { Actor } from "../shared/actor.ts";
import type { Keyset, RequestStore } from "../shared/store.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { decodeCursor, once, paginate, scopeOf } from "../shared/operations.ts";
export interface TagStore extends RequestStore {
  get(id: string, lock?: boolean): Promise<TagResult | null>;
  insert(name: string): Promise<TagResult>;
  rename(id: string, name: string): Promise<TagResult>;
  delete(id: string): Promise<void>;
  list(limit: number, after?: Keyset): Promise<TagResult[]>;
}
export interface TagDeps {
  uow: { run<T>(actor: Actor, fn: (store: TagStore) => Promise<T>): Promise<T> };
}
export function createTag(d: TagDeps, a: Actor, i: z.infer<typeof tagCreate>) {
  return d.uow.run(a, (s) => once(s, "create_tag", i.request_id, i, () => s.insert(i.name)));
}
export async function listTags(d: TagDeps, a: Actor, q: z.infer<typeof tagListQuery>) {
  const scope = await scopeOf(a, { list: "tags" });
  const after = q.cursor ? decodeCursor(q.cursor, scope) : undefined;
  return d.uow.run(a, async (s) => paginate(await s.list(q.limit + 1, after), q.limit, (t) => t.updated_at, scope));
}
async function requireVersion(s: TagStore, id: string, v: number) {
  const t = await s.get(id, true);
  if (!t) throw notFound();
  if (t.version !== v) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
}
export function renameTag(d: TagDeps, a: Actor, id: string, i: z.infer<typeof tagRename>) {
  return d.uow.run(a, async (s) => {
    await requireVersion(s, id, i.expected_version);
    return s.rename(id, i.name);
  });
}
export function deleteTag(d: TagDeps, a: Actor, id: string, v: number) {
  return d.uow.run(a, async (s) => {
    await requireVersion(s, id, v);
    await s.delete(id);
  });
}
