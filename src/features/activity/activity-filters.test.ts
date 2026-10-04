import { expect, it } from "vitest";
import { activityTags, periodBounds } from "./activity-filters.ts";
it("includes the complete civil end date and permits one-sided ranges",()=>{
  expect(periodBounds("2026-10-03","2026-10-05")?.to).toBe(new Date("2026-10-05T23:59:59.999").toISOString());
  expect(periodBounds("","2026-10-05")?.from).toBeUndefined();
  expect(periodBounds("2026-10-06","2026-10-05")).toBeNull();
});
it("normalizes old and plural activity tags without dropping selections",()=>{
  expect(activityTags(new URLSearchParams("tag_id=b&tag_ids=c,a,b"))).toEqual(["a","b","c"]);
});
