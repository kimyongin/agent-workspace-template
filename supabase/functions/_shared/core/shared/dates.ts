// 날짜만 쓰는 값(YYYY-MM-DD)의 계산. 시간대와 무관한 달력 날짜로 다룬다.

const DAY_MS = 86_400_000;

/** 1970-01-01부터의 일 수. */
export function toDayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

/** ISO 요일: 1=월 … 7=일. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 주어진 시각이 그 시간대에서 어느 날짜인지. "오늘"은 항상 할 일의 시간대로 판단한다. */
export function dateIn(timezone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
