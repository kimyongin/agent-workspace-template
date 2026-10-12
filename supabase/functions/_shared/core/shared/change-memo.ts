import type { ChangeInput } from "./changes.ts";
import { changed } from "./changes.ts";
const actions = { create: "등록", update: "수정", delete: "삭제", restore: "복원", stop: "중단", resume: "재개" };
const labels: Record<string, string> = {
  source: "발급처",
  external_id: "식별자",
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
  const fields = changedFieldNames(input);
  return fields.length ? `${base} (${fields.join(", ")})` : base;
}

/** Field names are separate from the target and action for editable default templates. */
export function changedFieldNames(input: ChangeInput): string[] {
  if (!input.before || !input.after) return [];
  const before = input.before;
  const properties = Object.entries(input.after.properties ?? {}).filter(([key, value]) =>
    changed({[key]:before.properties?.[key]}, {[key]:value})
  ).map(([key]) => input.after?.property_labels?.[key] ?? key);
  return [...properties, ...Object.entries(input.after).filter(([key, value]) =>
    !["properties", "property_labels", "entity_type_id", "schema_version"].includes(key) &&
    changed({ [key]: before[key as keyof typeof before] }, { [key]: value })
  ).map(([key]) => labels[key] ?? key)];
}
