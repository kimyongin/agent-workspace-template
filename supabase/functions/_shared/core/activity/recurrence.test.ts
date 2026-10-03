import { assertEquals } from "@std/assert";
import type { Recurrence } from "../../contracts/task.ts";
import { dateIn } from "../shared/dates.ts";
import { listOccurrences, occurrenceDates, occurrenceStatus } from "./recurrence.ts";

const daily: Recurrence = { freq: "daily", starts_on: "2026-01-01" };

Deno.test("매일: 시작일 이전은 회차가 아니다", () => {
  assertEquals(occurrenceDates(daily, [], "2025-12-30", "2026-01-02"), ["2026-01-01", "2026-01-02"]);
});

Deno.test("매주: ISO 요일(1=월, 7=일)", () => {
  // 2026-10-05는 월요일, 2026-10-11은 일요일.
  const rule: Recurrence = { freq: "weekly", weekdays: [1, 7], starts_on: "2026-10-01" };
  assertEquals(occurrenceDates(rule, [], "2026-10-05", "2026-10-12"), ["2026-10-05", "2026-10-11", "2026-10-12"]);
});

Deno.test("매월: 그 달에 없는 날짜는 마지막 날 회차", () => {
  const rule: Recurrence = { freq: "monthly", month_days: [31], starts_on: "2026-01-01" };
  assertEquals(occurrenceDates(rule, [], "2026-01-01", "2026-04-30"), [
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
  // 윤년 2월
  assertEquals(occurrenceDates(rule, [], "2028-02-01", "2028-02-29"), ["2028-02-29"]);
});

Deno.test("매월: 30·31일이 같은 마지막 날로 겹치면 회차 하나", () => {
  const rule: Recurrence = { freq: "monthly", month_days: [30, 31], starts_on: "2026-01-01" };
  assertEquals(occurrenceDates(rule, [], "2026-02-01", "2026-02-28"), ["2026-02-28"]);
  assertEquals(occurrenceDates(rule, [], "2026-03-01", "2026-03-31"), ["2026-03-30", "2026-03-31"]);
});

Deno.test("중단 기간(중단일~재개 전날)에는 회차가 없다", () => {
  const pauses = [{ stopped_on: "2026-01-03", resumed_on: "2026-01-05" }];
  assertEquals(occurrenceDates(daily, pauses, "2026-01-01", "2026-01-06"), [
    "2026-01-01",
    "2026-01-02",
    "2026-01-05",
    "2026-01-06",
  ]);
  const open = [{ stopped_on: "2026-01-03", resumed_on: null }];
  assertEquals(occurrenceDates(daily, open, "2026-01-01", "2026-01-10"), ["2026-01-01", "2026-01-02"]);
});

Deno.test("시간대 경계: 같은 순간도 할 일의 시간대에 따라 날짜가 다르다", () => {
  const at = new Date("2026-10-03T15:30:00Z");
  assertEquals(dateIn("Asia/Seoul", at), "2026-10-04");
  assertEquals(dateIn("UTC", at), "2026-10-03");
  assertEquals(dateIn("America/Los_Angeles", at), "2026-10-03");
  // 서울 자정 직전
  assertEquals(dateIn("Asia/Seoul", new Date("2026-10-03T14:59:59Z")), "2026-10-03");
});

Deno.test("회차 상태: 기록 있으면 done, 오늘 due, 지난 날 missed, 미래 upcoming", () => {
  assertEquals(occurrenceStatus("2026-01-01", "2026-01-02", 1), "done");
  assertEquals(occurrenceStatus("2026-01-02", "2026-01-02", 0), "due");
  assertEquals(occurrenceStatus("2026-01-01", "2026-01-02", 0), "missed");
  assertEquals(occurrenceStatus("2026-01-03", "2026-01-02", 0), "upcoming");
});

Deno.test("규칙 수정: 새 규칙으로 다시 계산하고 기존 기록은 규칙 밖 기록으로 남긴다", () => {
  const records = [
    { id: "r1", occurrence_on: "2026-10-06" }, // 화요일: 예전 규칙(매일)에서 남긴 기록
    { id: "r2", occurrence_on: "2026-10-05" },
    { id: "r3", occurrence_on: "2026-10-05" },
  ];
  const mondays: Recurrence = { freq: "weekly", weekdays: [1], starts_on: "2026-10-01" };
  const out = listOccurrences(mondays, [], records, "2026-10-05", "2026-10-13", "2026-10-07");
  assertEquals(out, [
    { date: "2026-10-05", status: "done", record_ids: ["r2", "r3"], in_rule: true },
    { date: "2026-10-06", status: "done", record_ids: ["r1"], in_rule: false },
    { date: "2026-10-12", status: "upcoming", record_ids: [], in_rule: true },
  ]);
});
