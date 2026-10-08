import { civilDayBounds, browserTimezone } from "../../lib/format.ts";
export const removedActivityFilters = ["kind", "status", "record_kind", "mode", "collapsed"];
export const ACTIVITY_TAG_LIMIT = 10;
export function activityTags(params: URLSearchParams) {
  return [...new Set([...(params.get("tag_ids")?.split(",") ?? []), ...(params.get("tag_id") ? [params.get("tag_id")!] : [])])].filter(Boolean).sort();
}
export function periodBounds(from: string, to: string, timezone = browserTimezone()) {
  if (from && to && from > to) return null;
  if ([from, to].some(value => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) return null;
  try { return civilDayBounds(from, to, timezone); } catch { return null; }
}
