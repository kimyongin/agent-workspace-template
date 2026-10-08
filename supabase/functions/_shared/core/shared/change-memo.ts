import type { ChangeInput } from "./changes.ts";
import { changed } from "./changes.ts";
const actions = { create: "등록", update: "수정", delete: "삭제", stop: "중단", resume: "재개", restore: "복원" };
const labels: Record<string, string> = {
  source: "발급처",
  external_id: "식별자",
  prop1: "속성 1",
  prop2: "속성 2",
  prop3: "속성 3",
  prop4: "속성 4",
  title: "제목",
  body: "본문",
  status: "상태",
  kind: "종류",
  due_on: "기한",
  recurrence: "반복 규칙",
  timezone: "시간대",
  tag_ids: "태그",
  entity_ids: "엔터티",
  pauses: "중단 기간",
};
/** Preserve entered notes exactly; blank notes describe observable action and changed fields. */
export function changeBody(input: ChangeInput): string {
  if (input.change_note?.trim()) return input.change_note;
  const base = `${input.target.title} ${actions[input.action]}`;
  if (!input.before || !input.after || input.action !== "update") return base;
  const before = input.before;
  const fields = Object.entries(input.after).filter(([key, value]) =>
    changed({ [key]: before[key as keyof typeof before] }, { [key]: value })
  ).map(([key]) => labels[key] ?? key);
  return fields.length ? `${base} (${fields.join(", ")})` : base;
}
