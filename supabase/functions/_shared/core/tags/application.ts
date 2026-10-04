import type { z } from "zod";
import type { tagCreate, tagListQuery, tagRename, TagResult } from "../../contracts/tag.ts";
import type { Actor } from "../shared/actor.ts";
import type { Keyset, RequestStore } from "../shared/store.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { decodeCursor, once, paginate, scopeOf } from "../shared/operations.ts";
import type { ChangeInput, ChangeStore } from "../shared/changes.ts";
export interface TagStore extends RequestStore, ChangeStore {
  get(id: string, lock?: boolean): Promise<TagResult | null>;
  insert(name: string, scope: "entity" | "activity"): Promise<TagResult>;
  rename(id: string, name: string): Promise<TagResult>;
  delete(id: string): Promise<void>;
  unlinkUses(id: string): Promise<ChangeInput[]>;
  list(limit: number, after?: Keyset, scope?: "entity" | "activity"): Promise<TagResult[]>;
}
export interface TagDeps {
  uow: { run<T>(actor: Actor, fn: (store: TagStore) => Promise<T>): Promise<T> };
}
export function createTag(d: TagDeps, a: Actor, i: z.infer<typeof tagCreate>) {
  return d.uow.run(a, (s) => once(s, "create_tag", i.request_id, i, () => s.insert(i.name, i.scope)));
}
export async function listTags(d: TagDeps, a: Actor, q: z.infer<typeof tagListQuery>) {
  const scope = await scopeOf(a, { list: "tags", scope: q.scope });
  const after = q.cursor ? decodeCursor(q.cursor, scope) : undefined;
  return d.uow.run(
    a,
    async (s) => paginate(await s.list(q.limit + 1, after, q.scope), q.limit, (t) => t.updated_at, scope),
  );
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
export function deleteTag(d: TagDeps, a: Actor, id: string, v: number, change_note?: string, request_id?: string) {
  return d.uow.run(a, (s) =>
    once(s, `delete_tag:${id}`, request_id, { expected_version: v, change_note }, async () => {
      await requireVersion(s, id, v);
      for (const change of await s.unlinkUses(id)) await s.appendChange({ ...change, change_note });
      await s.delete(id);
      return { deleted: true };
    }));
}
