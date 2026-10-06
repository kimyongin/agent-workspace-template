import { principleChangeFacts, principleChangeTarget } from "./change.ts";
import type {
  PrincipleCreate,
  PrinciplePreview,
  PrincipleResult,
  PrincipleSave,
  PrincipleUpdate,
} from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { changed } from "../shared/changes.ts";
import { basicChangeMemo } from "../shared/change-memo.ts";
import type { ChangeMemo } from "../../contracts/change.ts";
import { once, searchInputHash } from "../shared/operations.ts";
import type { PrincipleStore, PrincipleUnitOfWork } from "./ports.ts";
export interface PrincipleDeps {
  uow: PrincipleUnitOfWork;
}
function requirePrinciple(p: PrincipleResult | null, id: string) {
  if (!p?.is_current || p.id !== id) throw notFound();
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
          target_title: command.input.title,
          before: null,
          after: principleChangeFacts(command.input),
          change_note: command.input.change_note,
        }),
        changed: true,
      };
    }
    const old = requirePrinciple(await s.get(command.id), command.id);
    if (!old.is_current || current?.id !== old.id) {
      throw conflict("현재 원칙만 변경할 수 있습니다. 현재 문서를 다시 조회하세요.");
    }
    version(old, command.input.expected_version);
    const after = command.action === "delete"
      ? null
      : { ...old, title: command.input.title, summary: command.input.summary, body: command.input.body };
    return {
      memo: basicChangeMemo({
        action: command.action,
        target_title: (after ?? old).title,
        before: principleChangeFacts(old),
        after: after && principleChangeFacts(after),
        change_note: command.input.change_note,
      }),
      changed: after === null || changed(old, { title: after.title, summary: after.summary, body: after.body }),
    };
  });
}
async function save(s: PrincipleStore, i: PrincipleSave, old: PrincipleResult | null, firstOnly = false) {
  if (firstOnly && old) throw conflict("현재 원칙이 있습니다. 현재 문서를 편집하세요.");
  if (old) {
    version(old, i.expected_version);
  } else if (i.expected_version !== undefined) throw conflict("현재 원칙이 없습니다. 다시 조회하세요.");
  const { expected_version: _v, request_id: _r, change_memo, ...content } = i;
  if (old && !changed(old, { title: i.title, summary: i.summary, body: i.body })) return old;
  const result = old ? await s.update(old.id, content) : await s.insert(content);
  await s.enqueueIndex({ kind: "principle", id: result.id, input_hash: await searchInputHash(result) });
  await s.appendChange({
    target_kind: "principle",
    target: principleChangeTarget(result),
    action: old ? "update" : "create",
    before: old && principleChangeFacts(old),
    after: principleChangeFacts(result),
    change_note: i.change_note,
    change_memo,
  });
  return result;
}
export function saveCurrentPrinciple(d: PrincipleDeps, a: Actor, i: PrincipleSave) {
  return d.uow.run(
    a,
    (s) =>
      once(s, "save_current_principle", i.request_id, i, async () => save(s, i, await s.current({ forUpdate: true }))),
  );
}
export function createPrinciple(d: PrincipleDeps, a: Actor, i: PrincipleCreate) {
  return d.uow.run(
    a,
    (s) =>
      once(s, "create_principle", i.request_id, i, async () => save(s, i, await s.current({ forUpdate: true }), true)),
  );
}
export function currentPrinciple(d: PrincipleDeps, a: Actor) {
  return d.uow.run(a, async (s) => ({ current: await s.current() }));
}
export function updatePrinciple(d: PrincipleDeps, a: Actor, id: string, i: PrincipleUpdate) {
  return d.uow.run(a, (s) =>
    once(s, `update_principle:${id}`, i.request_id, i, async () => {
      const old = requirePrinciple(await s.current({ forUpdate: true }), id);
      return save(s, {
        title: i.title ?? old.title,
        summary: i.summary ?? old.summary,
        body: i.body ?? old.body,
        expected_version: i.expected_version,
        change_note: i.change_note,
        change_memo: i.change_memo,
      }, old);
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
        const old = requirePrinciple(await s.current({ forUpdate: true }), id);
        version(old, expected);
        if (!old.is_current) throw conflict("과거 자료는 통합 기록에서 확인하세요. 현재 원칙만 삭제할 수 있습니다.");
        await s.delete(id);
        await s.appendChange({
          target_kind: "principle",
          target: principleChangeTarget(old),
          action: "delete",
          before: principleChangeFacts(old),
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
    if (!p?.is_current) throw notFound();
    return p;
  });
}
