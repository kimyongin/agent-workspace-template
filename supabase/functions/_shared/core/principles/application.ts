import type {
  PrincipleCorrection,
  PrincipleCreate,
  PrincipleListQuery,
  PrinciplePreview,
  PrincipleSave,
  PrincipleUpdate,
} from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { changed } from "../shared/changes.ts";
import { basicChangeMemo } from "../shared/change-memo.ts";
import type { ChangeMemo } from "../../contracts/change.ts";
import { decodeCursor, once, paginate, scopeOf, searchInputHash } from "../shared/operations.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "./ports.ts";
export interface PrincipleDeps {
  uow: PrincipleUnitOfWork;
}
async function requirePrinciple(s: PrincipleStore, id: string) {
  const p = await s.get(id, true);
  if (!p) throw notFound();
  return p;
}
function version(p: { version: number }, v: number | undefined) {
  if (p.version !== v) throw conflict("다른 변경이 저장되어 있습니다. 현재 원칙을 다시 확인하세요.");
}
export function previewPrincipleChange(d: PrincipleDeps, a: Actor, command: PrinciplePreview) {
  return d.uow.run(a, async (s) => {
    const current = await s.current();
    if (command.action === "create") {
      if (current) throw conflict("현재 원칙이 있습니다. 현재 문서를 편집하세요.");
      return {
        memo: basicChangeMemo({
          action: "create",
          before: null,
          after: command.input,
          change_note: command.input.change_note,
        }),
        changed: true,
      };
    }
    const old = await requirePrinciple(s, command.id);
    if (!old.is_current || current?.id !== old.id) {
      throw conflict("현재 원칙만 변경할 수 있습니다. 현재 문서를 다시 조회하세요.");
    }
    version(old, command.input.expected_version);
    const after = command.action === "delete"
      ? null
      : { ...old, title: command.input.title, summary: command.input.summary, body: command.input.body };
    return {
      memo: basicChangeMemo({ action: command.action, before: old, after, change_note: command.input.change_note }),
      changed: after === null || changed(old, { title: after.title, summary: after.summary, body: after.body }),
    };
  });
}
async function save(s: PrincipleStore, i: PrincipleSave, firstOnly = false) {
  await s.lockCurrent();
  const old = await s.current();
  if (firstOnly && old) throw conflict("현재 원칙이 있습니다. 현재 문서를 편집하세요.");
  if (old) {
    version(old, i.expected_version);
  } else if (i.expected_version !== undefined) throw conflict("현재 원칙이 없습니다. 다시 조회하세요.");
  const { expected_version: _v, request_id: _r, change_memo, ...content } = i;
  if (old && !changed(old, { title: i.title, summary: i.summary, body: i.body })) return old;
  const revision = await s.nextVersion();
  const result = old ? await s.update(old.id, content, revision) : await s.insert(content, revision);
  await s.enqueueIndex({ kind: "principle", id: result.id, input_hash: await searchInputHash(result) });
  await s.appendChange({
    target_kind: "principle",
    action: old ? "update" : "create",
    before: old,
    after: result,
    change_note: i.change_note,
    change_memo,
  });
  return result;
}
export function saveCurrentPrinciple(d: PrincipleDeps, a: Actor, i: PrincipleSave) {
  return d.uow.run(a, (s) => once(s, "save_current_principle", i.request_id, i, () => save(s, i)));
}
export function createPrinciple(d: PrincipleDeps, a: Actor, i: PrincipleCreate) {
  return d.uow.run(a, (s) => once(s, "create_principle", i.request_id, i, () => save(s, i, true)));
}
export function currentPrinciple(d: PrincipleDeps, a: Actor) {
  return d.uow.run(a, async (s) => ({ current: await s.current() }));
}
export function updatePrinciple(d: PrincipleDeps, a: Actor, id: string, i: PrincipleUpdate) {
  return d.uow.run(a, (s) =>
    once(s, `update_principle:${id}`, i.request_id, i, async () => {
      await s.lockCurrent();
      const old = await requirePrinciple(s, id);
      if (!old.is_current) throw conflict("과거본은 정정 기능을 사용하세요");
      return save(s, {
        title: i.title ?? old.title,
        summary: i.summary ?? old.summary,
        body: i.body ?? old.body,
        expected_version: i.expected_version,
        change_note: i.change_note,
        change_memo: i.change_memo,
      });
    }));
}
export function correctPrinciple(d: PrincipleDeps, a: Actor, id: string, i: PrincipleCorrection | PrincipleUpdate) {
  return d.uow.run(a, (s) =>
    once(s, `correct_principle:${id}`, i.request_id, i, async () => {
      await s.lockCurrent();
      const old = await requirePrinciple(s, id);
      version(old, i.expected_version);
      if (old.is_current) throw conflict("현재 원칙은 새 저장본으로 편집하세요");
      const { expected_version: _v, request_id: _r, change_note, ...changes } = i;
      if (!changed(old, changes) && old.change_note === change_note) return old;
      const result = await s.update(id, { ...changes, change_note });
      if (old.title !== result.title || old.summary !== result.summary) {
        await s.enqueueIndex({ kind: "principle", id, input_hash: await searchInputHash(result) });
      }
      await s.appendChange({ target_kind: "principle", action: "update", before: old, after: result, change_note });
      return result;
    }));
}
export function deletePrinciple(
  d: PrincipleDeps,
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
      once(s, `delete_principle:${id}`, request_id, { expected, change_note, change_memo }, async () => {
        await s.lockCurrent();
        const old = await requirePrinciple(s, id);
        version(old, expected);
        if (!old.is_current) throw conflict("과거 자료는 통합 기록에서 확인하세요. 현재 원칙만 삭제할 수 있습니다.");
        await s.delete(id);
        await s.nextVersion();
        await s.appendChange({
          target_kind: "principle",
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
export function getPrinciple(d: PrincipleDeps, a: Actor, id: string) {
  return d.uow.run(a, async (s) => {
    const p = await s.get(id);
    if (!p) throw notFound();
    return p;
  });
}
export async function listPrinciples(d: PrincipleDeps, a: Actor, q: PrincipleListQuery) {
  const scope = await scopeOf(a, { list: "principles", view: q.view });
  const after = q.cursor ? decodeCursor(q.cursor, scope) : undefined;
  return d.uow.run(
    a,
    async (s) => paginate(await s.list({ view: q.view, limit: q.limit + 1, after }), q.limit, (p) => p.saved_at, scope),
  );
}
