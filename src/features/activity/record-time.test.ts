import { expect, it, vi } from "vitest";
import { recordDraftFrom, recordDraftTime } from "./forms.tsx";
import { fromLocalInput } from "../../lib/format.ts";
vi.mock("../../lib/api.ts", () => ({ api: vi.fn() }));

it("body-only result/general record edits preserve the stored seconds and milliseconds", () => {
  const original = { title: "상담 결과", summary: "상담 완료", body: "기존 메모", occurred_at: "2026-10-05T20:58:48.277Z" };
  const draft = recordDraftFrom(original);
  expect(recordDraftTime({ ...draft, body: "정정한 상담 메모" })).toBe(original.occurred_at);
});
it("an explicit user time change is saved; a new blank time still lets the server select now", () => {
  const draft = recordDraftFrom({ title: "상담", summary: "결과", body: "", occurred_at: "2026-10-05T20:58:48.277Z" });
  const edited = "2026-10-06T12:30";
  expect(recordDraftTime({ ...draft, occurred_at: edited })).toBe(fromLocalInput(edited));
  expect(recordDraftTime({ ...draft, occurred_at: "" })).toBeUndefined();
});
