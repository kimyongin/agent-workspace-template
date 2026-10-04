/** Records have no stored timezone; use the web display timezone, never a linked task's recurrence timezone. */
export function groupRecords<T extends { id: string; occurred_at: string }>(items: T[], timezone: string) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const groups = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const parts = format.formatToParts(new Date(item.occurred_at));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(item);
  }
  return [...groups].map(([date, records]) => ({ date, records }));
}

export function collapsedDates(params: URLSearchParams): Set<string> {
  return new Set((params.get("collapsed") ?? "").split(",").filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)));
}
