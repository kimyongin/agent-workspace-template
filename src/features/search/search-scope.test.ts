import { expect, test } from "vitest";
import { workspaceSearchScope } from "./search-scope.ts";
const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
test("saved search URLs send all tag selections, record kind and source scope", () => {
  const input = workspaceSearchScope(new URLSearchParams(`q=근거&kind=record&record_kind=change&tag_ids=${second},${first}&entity_id=app:00000000-0000-4000-8000-000000000001:${first}`));
  expect(input.kinds).toEqual(["record"]);
  expect(input.record_kind).toBe("change");
  expect(input.tag_ids).toEqual([first, second]);
  expect(input.entity_id).toBe(`app:00000000-0000-4000-8000-000000000001:${first}`);
});
test("retired saved search conditions fail rather than silently changing scope", () => {
  for (const condition of ["status=active", "status=inactive", "status=all", "principle_view=current", "principle_view=history", "principle_view=all"]) {
    expect(() => workspaceSearchScope(new URLSearchParams(`q=기준&${condition}`))).toThrow();
  }
});
test("invalid record filters are rejected before a search request", () => {
  expect(() => workspaceSearchScope(new URLSearchParams("q=근거&record_kind=unknown"))).toThrow();
});
