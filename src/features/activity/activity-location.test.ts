import { expect, test } from "vitest";
import { activityLocation } from "./activity-location.ts";

test("old page keys restore only the owning list and announce the split", () => {
  const result = activityLocation("records", new URLSearchParams("q=근거&tasks_pages=8&records_pages=3&scroll=90"), "");
  expect(result.route).toBe("/records");
  expect(result.params.get("pages")).toBe("3");
  expect(result.params.get("q")).toBe("근거");
  expect(result.params.get("scroll")).toBe("90");
  expect(result.params.has("tasks_pages")).toBe(false);
  expect(result.params.has("records_pages")).toBe(false);
  expect(result.params.get("legacy_activity")).toBe("1");
});

test("cross-tab create links keep their intended form and valid scope", () => {
  const result = activityLocation("tasks", new URLSearchParams("create=record&q=근거&kind=once&status=open&entity_id=entity&from=2026-10-01"), "");
  expect(result.route).toBe("/records");
  expect(result.params.get("create")).toBe("1");
  expect(result.params.get("entity_id")).toBe("entity");
  expect(result.params.get("from")).toBe("2026-10-01");
  expect(result.params.has("kind")).toBe(false);
  expect(result.params.has("status")).toBe(false);
});

test("old opposite anchors open their real list without changing the ID", () => {
  const hash = "#activity-records-00000000-0000-4000-8000-000000000001";
  const result = activityLocation("tasks", new URLSearchParams("records_pages=2&tasks_pages=4&scroll=70"), hash);
  expect(result.route).toBe("/records");
  expect(result.hash).toBe(hash);
  expect(result.params.get("pages")).toBe("2");
});

test("current independent URLs preserve their filters and need no transition", () => {
  const params = new URLSearchParams("kind=recurring&status=stopped&tag_ids=a,b&pages=2&mode=keyword");
  const result = activityLocation("tasks", params, "");
  expect(result.params.toString()).toBe(params.toString());
  expect(result.params.has("legacy_activity")).toBe(false);
});
