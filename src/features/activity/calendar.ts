import { Temporal } from "@js-temporal/polyfill";

export function calendarMonth(value: string | null, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  try {
    const parsed = Temporal.PlainYearMonth.from(value);
    return parsed.year >= 1 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function calendarDay(value: string | null, month: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !value.startsWith(`${month}-`)) return null;
  try {
    return Temporal.PlainDate.from(value).year >= 1 ? value : null;
  } catch {
    return null;
  }
}
