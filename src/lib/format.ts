// 표시 유틸. 시각은 지정한 표시 시간대로, 날짜만 쓰는 값은 그대로 보여 준다.

import { Temporal } from "@js-temporal/polyfill";
import { browserTimezone } from "./timezone.ts";
export { browserTimezone } from "./timezone.ts";

export function formatDateTime(iso: string | null | undefined, timezone = browserTimezone()): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));
}

export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** datetime-local 입력값(지정한 표시 시간대) ↔ ISO. */
export function toLocalInput(iso: string, timezone = browserTimezone()): string {
  return Temporal.Instant.from(iso).toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: "minute" });
}

export function fromLocalInput(value: string, timezone = browserTimezone()): string | undefined {
  if (!value) return undefined;
  try {
    const local = Temporal.PlainDateTime.from(value);
    // Compatible chooses the earlier repeated time. Reject gaps instead of silently moving input.
    const zoned = local.toZonedDateTime(timezone, { disambiguation: "compatible" });
    if (!local.equals(zoned.toPlainDateTime())) return undefined;
    return new Date(zoned.epochMilliseconds).toISOString();
  } catch { return undefined; }
}

/** Inclusive UTC bounds of real civil days, which can have 23 or 25 hours. */
export function civilDayBounds(from: string, to: string, timezone: string) {
  const start = (date: string) => Temporal.PlainDate.from(date).toZonedDateTime(timezone);
  return {
    from: from ? new Date(start(from).epochMilliseconds).toISOString() : undefined,
    to: to ? new Date(start(to).add({ days: 1 }).startOfDay().epochMilliseconds - 1).toISOString() : undefined,
  };
}

export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".") || "_";
    out[key] ??= i.message;
  }
  return out;
}
