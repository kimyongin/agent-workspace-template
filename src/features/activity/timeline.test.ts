import { describe, expect, it } from "vitest";
import { collapsedDates, groupRecords } from "./timeline.ts";
import { listScope, listDetailVisit, safeListReturn } from "./list-state.ts";

describe("record dates and return state", () => {
  it("uses the display timezone at midnight and preserves server order", () => {
    const records = [
      {id:"a",occurred_at:"2026-10-03T16:00:00Z"},
      {id:"b",occurred_at:"2026-10-03T15:00:00Z"},
      {id:"c",occurred_at:"2026-10-03T14:59:59Z"},
    ];
    expect(groupRecords(records,"Asia/Seoul")).toEqual([
      {date:"2026-10-04",records:records.slice(0,2)},
      {date:"2026-10-03",records:records.slice(2)},
    ]);
    expect(groupRecords(records,"America/Los_Angeles").map(g=>g.date)).toEqual(["2026-10-03"]);
  });
  it("merges a page continuing the same date and deduplicates by ID", () => {
    const a = {id:"a",occurred_at:"2026-10-03T16:00:00Z"};
    const b = {id:"b",occurred_at:"2026-10-03T15:00:00Z"};
    expect(groupRecords([a,a,b],"Asia/Seoul")).toEqual([{date:"2026-10-04",records:[a,b]}]);
  });
  it("keeps collapse state in the return URL without changing the data scope", () => {
    const params = new URLSearchParams("tag_id=t&pages=2&collapsed=2026-10-04,invalid,2026-10-03");
    expect([...collapsedDates(params)]).toEqual(["2026-10-04","2026-10-03"]);
    expect(listScope(params)).toBe("tag_id=t");
    expect(listDetailVisit("records",{pathname:"/records",search:params.toString(),hash:""},"r",120).back).toContain("collapsed=");
  });
});
