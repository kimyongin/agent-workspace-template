export const removedActivityFilters = ["entity_id", "kind", "status", "record_kind", "mode", "collapsed"];
export const ACTIVITY_TAG_LIMIT = 10;
export function activityTags(params: URLSearchParams) {
  return [...new Set([...(params.get("tag_ids")?.split(",") ?? []), ...(params.get("tag_id") ? [params.get("tag_id")!] : [])])].filter(Boolean).sort();
}
export function periodBounds(from: string, to: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = (value: string) => !value || date.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
  if (!validDate(from) || !validDate(to) || from && to && from > to) return null;
  // Local civil dates include the whole ending day, including DST transitions.
  return { from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined };
}
