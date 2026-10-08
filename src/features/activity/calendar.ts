import { Temporal } from "@js-temporal/polyfill";

export function calendarMonth(value: string | null, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  try { const parsed = Temporal.PlainYearMonth.from(value); return parsed.year >= 1 ? value : fallback; } catch { return fallback; }
}

export function calendarDay(value: string | null, month: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !value.startsWith(`${month}-`)) return null;
  try { Temporal.PlainDate.from(value); return value; } catch { return null; }
}

export function monthDays(month: string) {
  const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
  const leading = first.dayOfWeek % 7;
  // Pad with empty cells rather than inventing events from adjacent months.
  const length = Math.ceil((leading + first.daysInMonth) / 7) * 7;
  return Array.from({ length }, (_, index) => {
    const day = index - leading + 1;
    return day < 1 || day > first.daysInMonth ? null : first.with({ day }).toString();
  });
}

export function adjacentMonth(month: string, offset: number): string | null {
  try {
    const next = Temporal.PlainYearMonth.from(month).add({ months: offset });
    return next.year >= 1 && next.year <= 9999 ? next.toString() : null;
  } catch { return null; }
}

export function moveCalendarDay(date: string, offset: number): string | null {
  try {
    const next = Temporal.PlainDate.from(date).add({ days: offset });
    return next.year >= 1 && next.year <= 9999 ? next.toString() : null;
  } catch { return null; }
}
