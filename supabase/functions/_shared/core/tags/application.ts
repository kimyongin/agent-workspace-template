import {
  type TagConnectionInput,
  tagConnectionInput,
  type TagConnectionResult,
} from "../../contracts/tag-connection.ts";
import { runWrite } from "../shared/request.ts";
import type { z } from "zod";
import type { tagCreate, tagListQuery, tagRename, TagResult } from "../../contracts/tag.ts";
import type { Actor } from "../shared/actor.ts";
import type { Keyset } from "../shared/store.ts";
import { conflict, invalidInput, notFound } from "../shared/errors.ts";
import { decodeCursor, paginate, scopeOf } from "../shared/operations.ts";
import type { ChangeInput, ChangeStore } from "../shared/changes.ts";
import type { EntityValues } from "../../contracts/entity.ts";
import type { Task } from "../activity/domain.ts";
import type { ActivityRecord } from "../activity/ports.ts";
import { entityChangeFacts, entityChangeTarget } from "../entity/change.ts";
import { activityChangeTarget, recordChangeFacts, taskChangeFacts } from "../activity/change.ts";
export type TagUse =
  | { kind: "entity"; value: EntityValues }
  | { kind: "task"; value: Task }
  | { kind: "record"; value: ActivityRecord };
function facts(use: TagUse) {
  return use.kind === "entity"
    ? entityChangeFacts(use.value)
    : use.kind === "task"
    ? taskChangeFacts(use.value)
    : recordChangeFacts(use.value);
}
function target(use: TagUse) {
  return use.kind === "entity" ? entityChangeTarget(use.value) : activityChangeTarget(use.value);
}
export interface TagStore extends ChangeStore {
  prepareDelete?(id: string): Promise<void>;
  connectionTarget?(input: TagConnectionInput): Promise<TagUse | null>;
  listRecordTemplateTags?(limit: number, after?: Keyset): Promise<TagResult[]>;
  get(id: string, lock?: boolean): Promise<TagResult | null>;
  insert(name: string, scope: TagResult["scope"]): Promise<TagResult>;
  rename(id: string, name: string): Promise<TagResult>;
  delete(id: string): Promise<void>;
  /** Each use is locked and freshly read; the transaction retains that lock while the caller writes. */
  uses(id: string): AsyncIterable<TagUse>;
  setTags(use: TagUse, ids: string[]): Promise<TagUse>;
  list(limit: number, after?: Keyset, scope?: TagResult["scope"]): Promise<TagResult[]>;
}
export interface TagEntry {
  connection?: TagConnectionInput;
  deleteTagId?: string;
}
export interface TagDeps {
  uow: { run<T>(actor: Actor, fn: (store: TagStore) => Promise<T>, entry?: TagEntry): Promise<T> };
}
export function createTag(d: TagDeps, a: Actor, i: z.infer<typeof tagCreate>) {
  return runWrite(d.uow, a, "tag.create", null, i, (s) => s.insert(i.name, i.scope));
}
export async function listTags(d: TagDeps, a: Actor, q: z.infer<typeof tagListQuery>) {
  if (q.purpose && q.scope !== "record") throw invalidInput("기록 문구 설정에서는 기록 태그만 조회할 수 있습니다");
  const scope = await scopeOf(a, {
    list: "tags",
    scope: q.scope,
    workspace_id: a.workspaceId,
    ...(q.purpose ? { purpose: q.purpose, workspace_id: a.workspaceId } : {}),
  });
  const after = q.cursor ? decodeCursor(q.cursor, scope) : undefined;
  return d.uow.run(
    a,
    async (s) => {
      if (q.purpose && !s.listRecordTemplateTags) throw invalidInput("기록 문구 태그 조회 저장소가 필요합니다");
      const tags = q.purpose
        ? await s.listRecordTemplateTags!(q.limit + 1, after)
        : await s.list(q.limit + 1, after, q.scope);
      return paginate(tags, q.limit, (t) => t.updated_at, scope);
    },
  );
}
async function requireVersion(s: TagStore, id: string, v: number) {
  const t = await s.get(id, true);
  if (!t) throw notFound();
  if (t.version !== v) throw conflict("다른 변경이 저장되어 있습니다. 다시 조회하세요.");
}
export function renameTag(d: TagDeps, a: Actor, id: string, i: z.infer<typeof tagRename>) {
  return runWrite(d.uow, a, "tag.rename", id, i, async (s) => {
    await requireVersion(s, id, i.expected_version);
    return s.rename(id, i.name);
  });
}
export function deleteTag(
  d: TagDeps,
  a: Actor,
  id: string,
  v: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  return runWrite(d.uow, a, "tag.delete", id, { expected_version: v, change_note, change_tag_ids }, async (s) => {
    await s.prepareDelete?.(id);
    await requireVersion(s, id, v);
    if (change_tag_ids?.includes(id)) throw invalidInput("삭제할 태그는 기록에 붙일 수 없습니다");
    for await (const before of s.uses(id)) {
      if (!before.value.tag_ids.includes(id)) continue;
      const after = await s.setTags(before, before.value.tag_ids.filter((tag) => tag !== id));
      // Editing an automatic change record must never generate another automatic change record.
      if (before.kind === "record") continue;
      const change: ChangeInput = {
        target_kind: before.kind,
        target: target(after),
        action: "update",
        before: facts(before),
        after: facts(after),
        change_note,
        change_tag_ids,
      };
      await s.appendChange(change);
    }
    await s.delete(id);
    return { deleted: true };
  });
}

/** Links are a separate saved-target command, never a content partial update. */
export function setTagConnections(d: TagDeps, actor: Actor, raw: unknown): Promise<TagConnectionResult> {
  const parsed = tagConnectionInput.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "태그 연결 입력을 확인하세요",
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  const input = parsed.data;
  const uow: TagDeps["uow"] = { run: (a, fn) => d.uow.run(a, fn, { connection: input }) };
  return runWrite(
    uow,
    actor,
    "tag.connections.set",
    { kind: input.target_kind, id: input.target_id },
    input,
    async (store) => {
      const before = await store.connectionTarget?.(input);
      if (!before) throw notFound();
      if (before.value.version !== input.expected_version) {
        throw conflict(
          "다른 변경이 저장되어 있습니다. 다시 조회하세요.",
        );
      }
      if (before.kind === "entity" && before.value.deleted_at) {
        throw conflict(
          "삭제된 자료에는 태그를 연결할 수 없습니다",
        );
      }
      const same = JSON.stringify([...before.value.tag_ids].sort()) === JSON.stringify([...input.tag_ids].sort());
      const after = same ? before : await store.setTags(before, input.tag_ids);
      if (!same && after.kind !== "record") {
        await store.appendChange({
          target_kind: after.kind,
          target: target(after),
          action: "update",
          before: facts(before),
          after: facts(after),
          change_note: "change_note" in input ? input.change_note : undefined,
          change_tag_ids: "change_tag_ids" in input ? input.change_tag_ids : undefined,
        });
      }
      return { tag_ids: after.value.tag_ids, version: after.value.version, updated_at: after.value.updated_at };
    },
  );
}
