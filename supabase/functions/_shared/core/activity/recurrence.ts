// 반복 할 일의 회차 계산. 회차와 수행 여부는 저장하지 않고 규칙·중단 이력·기록으로 계산한다.
import type { Occurrence, Recurrence } from "../../contracts/task.ts";
import { addDays, daysInMonth, isoWeekday, toDayNumber } from "../shared/dates.ts";

export interface Pause {
  stopped_on: string;
  /** null이면 아직 중단 중. */
  resumed_on: string | null;
}

/** 규칙상 그 날짜가 회차인가(시작일·중단 기간은 보지 않음). */
export function matchesRule(rule: Recurrence, date: string): boolean {
  switch (rule.freq) {
    case "daily":
      return true;
    case "weekly":
      return rule.weekdays.includes(isoWeekday(date));
    case "monthly": {
      const [y, m, d] = date.split("-").map(Number);
      const last = daysInMonth(y, m);
      // 그 달에 없는 날짜(예: 31일)는 마지막 날로 옮긴다.
      return rule.month_days.some((day) => Math.min(day, last) === d);
    }
  }
}

/** 중단일부터 재개일 전날까지는 회차가 없다. */
export function isPaused(pauses: readonly Pause[], date: string): boolean {
  return pauses.some((p) => p.stopped_on <= date && (p.resumed_on === null || date < p.resumed_on));
}

export function isOccurrence(rule: Recurrence, pauses: readonly Pause[], date: string): boolean {
  return date >= rule.starts_on && !isPaused(pauses, date) && matchesRule(rule, date);
}

/** [from, to] 안의 회차 날짜. 호출자가 기간 한도(366일)를 검증한다. */
export function occurrenceDates(rule: Recurrence, pauses: readonly Pause[], from: string, to: string): string[] {
  const out: string[] = [];
  const start = from < rule.starts_on ? rule.starts_on : from;
  for (let d = start; d <= to; d = addDays(d, 1)) {
    if (isOccurrence(rule, pauses, d)) out.push(d);
  }
  return out;
}

export function occurrenceStatus(date: string, today: string, recordCount: number): Occurrence["status"] {
  if (recordCount > 0) return "done";
  if (date === today) return "due";
  return date < today ? "missed" : "upcoming";
}

export interface OccurrenceRecord {
  id: string;
  occurrence_on: string;
}

/**
 * 기간의 회차 목록. 규칙에 맞지 않게 된 기존 기록은 보존하며 `in_rule: false`로 함께 표시한다.
 */
export function listOccurrences(
  rule: Recurrence,
  pauses: readonly Pause[],
  records: readonly OccurrenceRecord[],
  from: string,
  to: string,
  today: string,
): Occurrence[] {
  const byDate = new Map<string, string[]>();
  for (const r of records) {
    if (r.occurrence_on < from || r.occurrence_on > to) continue;
    byDate.set(r.occurrence_on, [...(byDate.get(r.occurrence_on) ?? []), r.id]);
  }
  const dates = new Set(occurrenceDates(rule, pauses, from, to));
  for (const d of byDate.keys()) dates.add(d);
  return [...dates].sort().map((date) => {
    const ids = byDate.get(date) ?? [];
    return {
      date,
      status: occurrenceStatus(date, today, ids.length),
      record_ids: ids,
      in_rule: isOccurrence(rule, pauses, date),
    };
  });
}

export function rangeDays(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from) + 1;
}
