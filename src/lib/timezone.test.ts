import { expect, test, vi } from "vitest";
import { timezoneOptions, timezonePreference } from "./timezone.ts";
import { fromLocalInput, toLocalInput, formatDateTime } from "./format.ts";
import { periodBounds } from "../features/activity/activity-filters.ts";
import { recordDraftFrom, recordDraftTime, taskDraftFrom, emptyTask } from "../features/activity/forms.tsx";

vi.mock("./api.ts", () => ({ api: vi.fn() }));

test("account preferences accept named zones, retain aliases in options and fall back for unknown metadata", () => {
  expect(timezonePreference("Asia/Seoul")).toBe("Asia/Seoul");
  for (const value of [null, 42, "", "not/a-zone", "+09:00"]) expect(timezonePreference(value)).toBeNull();
  expect(timezoneOptions("US/Eastern")).toContain("US/Eastern");
  expect(timezoneOptions(null)).toContain("UTC");
});
test("selected zone controls displayed timestamp, local input and round-trip independently of device", () => {
  const iso = "2026-10-07T23:15:22.123Z";
  expect(toLocalInput(iso, "Asia/Seoul")).toBe("2026-10-08T08:15");
  expect(toLocalInput(iso, "America/New_York")).toBe("2026-10-07T19:15");
  expect(fromLocalInput("2026-10-08T08:15", "Asia/Seoul")).toBe("2026-10-07T23:15:00.000Z");
  expect(formatDateTime(iso, "Asia/Seoul")).toBe(new Intl.DateTimeFormat("ko-KR", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date(iso)));
});
test("inclusive search bounds follow the selected civil date and DST day length", () => {
  expect(periodBounds("2026-10-08", "2026-10-08", "Asia/Seoul")).toEqual({from:"2026-10-07T15:00:00.000Z",to:"2026-10-08T14:59:59.999Z"});
  expect(periodBounds("2026-03-08", "2026-03-08", "America/New_York")).toEqual({from:"2026-03-08T05:00:00.000Z",to:"2026-03-09T03:59:59.999Z"});
  expect(periodBounds("2026-11-01", "2026-11-01", "America/New_York")).toEqual({from:"2026-11-01T04:00:00.000Z",to:"2026-11-02T04:59:59.999Z"});
  expect(periodBounds("2026-02-30", "", "UTC")).toBeNull();
});
test("DST gaps cannot silently change record time, repeated times use earlier instant and untouched records retain precision", () => {
  expect(fromLocalInput("2026-03-08T02:30", "America/New_York")).toBeUndefined();
  expect(fromLocalInput("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  const draft = recordDraftFrom({body:"메모",occurred_at:"2026-11-01T06:30:41.222Z"}, "America/New_York");
  expect(recordDraftTime({...draft,body:"정정"},"America/New_York")).toBe("2026-11-01T06:30:41.222Z");
});
test("display zone initializes new recurring drafts without rewriting existing schedules", () => {
  expect(emptyTask("America/New_York").timezone).toBe("America/New_York");
  expect(taskDraftFrom({kind:"recurring",title:"일정",body:"",due_on:null,tag_ids:[],recurrence:{freq:"daily",starts_on:"2026-10-08"},timezone:"Asia/Seoul"},"America/New_York").timezone).toBe("Asia/Seoul");
});
