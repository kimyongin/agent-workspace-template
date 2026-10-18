import { expect, it, vi } from "vitest";
import { recordDraftFrom, recordDraftTime } from "./forms.tsx";
import { fromLocalInput } from "../../lib/format.ts";
vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn() }));

it("body-only result/general record edits preserve the stored seconds and milliseconds", () => {
  const original = { body: "기존 메모", occurred_at: "2026-10-05T20:58:48.277Z" };
  const draft = recordDraftFrom(original);
  expect(recordDraftTime({ ...draft, body: "정정한 상담 메모" })).toBe(original.occurred_at);
});
it("an explicit user time change is saved; a new blank time still lets the server select now", () => {
  const draft = recordDraftFrom({ body: "", occurred_at: "2026-10-05T20:58:48.277Z" });
  const edited = "2026-10-06T12:30";
  expect(recordDraftTime({ ...draft, occurred_at: { date: "2026-10-06", time: "12:30" } })).toBe(fromLocalInput(edited));
  expect(recordDraftTime({ ...draft, occurred_at: { date: "", time: "" } })).toBeUndefined();
});

it("result content drafts omit parent selections while retaining saved classification", () => {
  const saved = { body: "수행 결과", occurred_at: "2026-10-05T20:58:48.277Z", tag_ids: ["tag"], entity_ids: ["protected-material"] };
  const draft = recordDraftFrom(saved);
  expect(draft.tag_ids).toEqual(["tag"]);
  expect(draft).not.toHaveProperty("entity_ids");
  expect(draft).not.toHaveProperty("entity_context");
  expect(draft).not.toHaveProperty("task_id");
});
