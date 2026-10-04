import { assertEquals } from "@std/assert";
import { occurrenceRange, recurrence, taskCreate, taskUpdate } from "./task.ts";

Deno.test("생성: 서버 관리 필드와 종류에 없는 필드는 거부", () => {
  assertEquals(taskCreate.safeParse({ kind: "once", title: "a", summary: "b" }).success, true);
  assertEquals(taskCreate.safeParse({ kind: "once", title: "a", summary: "b", status: "done" }).success, false);
  assertEquals(taskCreate.safeParse({ kind: "once", title: "a", summary: "b", timezone: "UTC" }).success, false);
  assertEquals(taskCreate.safeParse({ kind: "recurring", title: "a", summary: "b" }).success, false);
});

Deno.test("반복 규칙과 시간대 검증", () => {
  assertEquals(recurrence.safeParse({ freq: "weekly", weekdays: [], starts_on: "2026-10-01" }).success, false);
  assertEquals(recurrence.safeParse({ freq: "weekly", weekdays: [8], starts_on: "2026-10-01" }).success, false);
  const monthly = recurrence.parse({ freq: "monthly", month_days: [31, 1, 31], starts_on: "2026-10-01" });
  assertEquals(monthly.freq === "monthly" && monthly.month_days, [1, 31]);
  const t = taskCreate.safeParse({
    kind: "recurring",
    title: "a",
    summary: "b",
    recurrence: { freq: "daily", starts_on: "2026-10-01" },
    timezone: "Mars/Olympus",
  });
  assertEquals(t.success, false);
});

Deno.test("수정: 바꿀 필드가 있어야 하고 kind·status는 거부", () => {
  assertEquals(taskUpdate.safeParse({ change_note: "테스트 변경 이유", expected_version: 1 }).success, false);
  assertEquals(
    taskUpdate.safeParse({ change_note: "테스트 변경 이유", expected_version: 1, kind: "recurring" }).success,
    false,
  );
  assertEquals(
    taskUpdate.safeParse({ change_note: "테스트 변경 이유", expected_version: 1, due_on: null }).success,
    true,
  );
});

Deno.test("회차 기간은 최대 366일", () => {
  // 양 끝 포함 366일
  assertEquals(occurrenceRange.safeParse({ from: "2026-01-01", to: "2027-01-01" }).success, true);
  assertEquals(occurrenceRange.safeParse({ from: "2026-01-01", to: "2027-01-02" }).success, false);
  assertEquals(occurrenceRange.safeParse({ from: "2026-01-02", to: "2026-01-01" }).success, false);
});
