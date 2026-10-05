import type { ChangeMemo } from "../../contracts/change.ts";
import type { ChangeInput } from "./changes.ts";
import { changed } from "./changes.ts";

const labels: Record<string, string> = {
  prop1: "속성 1",
  prop2: "속성 2",
  prop3: "속성 3",
  prop4: "속성 4",
  title: "제목",
  summary: "요약",
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
const words = { create: "등록", update: "수정", delete: "삭제", stop: "중단", resume: "재개" };
const display = (v: unknown) => {
  const text = v === undefined || v === null || v === "" ? "없음" : typeof v === "string" ? v : JSON.stringify(v);
  const chars = Array.from(text);
  return chars.length > 1000 ? `${chars.slice(0, 1000).join("")}… (일부 생략)` : text;
};
/** Only known business facts enter the memo; timestamps, credentials and transport metadata do not. */
export function basicChangeMemo(input: Pick<ChangeInput, "action" | "before" | "after" | "change_note">): ChangeMemo {
  const before = input.before as Record<string, unknown> | null, after = input.after as Record<string, unknown> | null;
  const target = after ?? before ?? {}, name = String(target.prop1 ?? target.title ?? "업무 대상");
  const title = `${Array.from(name).slice(0, 90).join("")} ${words[input.action]}`;
  const lines = Object.entries(labels).filter(([key]) => {
    if (!(key in (after ?? before ?? {}))) return false;
    return !before || !after || changed({ value: before[key] }, { value: after[key] });
  }).map(([key, label]) =>
    before && after ? `${label}: ${display(before[key])} → ${display(after[key])}` : `${label}: ${display(target[key])}`
  );
  return {
    title,
    summary: Array.from(input.change_note ?? title).slice(0, 300).join(""),
    body: [...lines, ...(input.change_note ? ["", `메모: ${input.change_note}`] : [])].join("\n"),
  };
}
