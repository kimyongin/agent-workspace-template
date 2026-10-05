import { expect, test } from "vitest";
import { workspaceSearchScope } from "./search-scope.ts";
const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
test("saved search URLs send all tag selections, record kind and source scope", () => {
  const input = workspaceSearchScope(new URLSearchParams(`q=근거&kind=record&record_kind=change&tag_ids=${second},${first}&entity_id=${first}`));
  expect(input.kinds).toEqual(["record"]);
  expect(input.record_kind).toBe("change");
  expect(input.tag_ids).toEqual([first, second]);
  expect(input.entity_id).toBe(first);
});
test("new searches use current principles; explicit old scope stays recognizable", () => {
  expect(workspaceSearchScope(new URLSearchParams("q=기준")).principle_view).toBe("current");
  expect(workspaceSearchScope(new URLSearchParams("q=기준&status=inactive")).principle_view).toBe("history");
});
test("invalid record filters are rejected before a search request", () => {
  expect(() => workspaceSearchScope(new URLSearchParams("q=근거&record_kind=unknown"))).toThrow();
});
