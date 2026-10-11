import { runWrite } from "../shared/request.ts";
import { principleChangeFacts, principleChangeTarget } from "./change.ts";
import type { PrincipleCreate, PrincipleResult, PrincipleUpdate } from "../../contracts/principle.ts";
import type { Actor } from "../shared/actor.ts";
import { conflict, notFound } from "../shared/errors.ts";
import { changed } from "../shared/changes.ts";
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
async function save(s: PrincipleStore, i: PrincipleCreate, old: PrincipleResult | null) {
  if (old && !changed(old, { title: i.title, body: i.body })) return old;
  const { change_note: _note, change_tag_ids: _tags, ...content } = i;
  const result = old ? await s.update(old.id, content) : await s.insert(i);

  await s.appendChange({
    target_kind: "principle",
    target: principleChangeTarget(result),
    action: old ? "update" : "create",
    before: old && principleChangeFacts(old),
    after: principleChangeFacts(result),
    change_note: i.change_note,
    change_tag_ids: i.change_tag_ids,
  });
  return result;
}
export function createPrinciple(d: PrincipleDeps, a: Actor, i: PrincipleCreate) {
  return runWrite(d.uow, a, "principle.create", null, i, async (s) => {
    if (await s.current({ forUpdate: true })) throw conflict("현재 원칙이 있습니다. 현재 문서를 편집하세요.");
    return save(s, i, null);
  });
}
export function currentPrinciple(d: PrincipleDeps, a: Actor) {
  return d.uow.run(a, async (s) => ({ current: await s.current() }));
}
export function updatePrinciple(d: PrincipleDeps, a: Actor, id: string, i: PrincipleUpdate) {
  return runWrite(d.uow, a, "principle.update", id, i, async (s) => {
    const old = requirePrinciple(await s.current({ forUpdate: true }), id);
    version(old, i.expected_version);
    return save(s, {
      title: i.title ?? old.title,
      body: i.body ?? old.body,
      change_note: i.change_note,
      change_tag_ids: i.change_tag_ids,
    }, old);
  });
}
export function deletePrinciple(
  d: PrincipleDeps,
  a: Actor,
  id: string,
  expected: number,
  change_note?: string,
  change_tag_ids?: string[],
) {
  return runWrite(
    d.uow,
    a,
    "principle.delete",
    id,
    { expected_version: expected, change_note, change_tag_ids },
    async (s) => {
      const old = requirePrinciple(await s.current({ forUpdate: true }), id);
      version(old, expected);
      await s.delete(id);
      await s.appendChange({
        target_kind: "principle",
        target: principleChangeTarget(old),
        action: "delete",
        before: principleChangeFacts(old),
        after: null,
        change_note,
        change_tag_ids,
      });
      return { deleted: true };
    },
  );
}
export function getPrinciple(d: PrincipleDeps, a: Actor, id: string) {
  return d.uow.run(a, async (s) => requirePrinciple(await s.get(id), id));
}
