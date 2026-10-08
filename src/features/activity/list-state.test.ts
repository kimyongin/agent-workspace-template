import { describe, expect, it } from "vitest";
import { anchorId,listReturnPath,listScope,requestedPages,safeListReturn } from "./list-state.ts";

describe("list return paths",()=>{
  it("preserves all URL filters, loaded extent and the focus target while constraining return paths", () => {
    const params = new URLSearchParams("kind=once&status=open&tag_id=tag&entity_id=entity&pages=3&scroll=9");
    const id = "00000000-0000-4000-8000-000000000001";
    const path = listReturnPath("tasks", params, id, 234.6);
    const url = new URL(path, "https://activity.invalid");
    expect(url.searchParams.get("pages")).toBe("3");
    expect(url.searchParams.get("scroll")).toBe("235");
    expect(url.searchParams.get("entity_id")).toBe("entity");
    expect(anchorId("tasks", url.hash)).toBe(id);
    expect(anchorId("records", url.hash)).toBeUndefined();
    expect(listScope(url.searchParams)).toBe("entity_id=entity&kind=once&status=open&tag_id=tag");
    expect(safeListReturn(path, "tasks", "/tasks")).toBe(path);
    for (
      const unsafe of ["https://evil.invalid/tasks", "//evil.invalid/tasks", "/tasks/other", "/principles", "/tasks\\x"]
    ) {
      expect(safeListReturn(unsafe, "tasks", "/tasks")).toBe("/tasks");
    }
    expect(safeListReturn("/records?tasks_pages=2", "tasks", "/tasks")).toBe("/tasks?pages=2&legacy_activity=1");
    expect(safeListReturn("/records?q=unrelated", "tasks", "/tasks")).toBe("/tasks");
    expect(safeListReturn(`/tasks?records_pages=2#activity-records-${id}`, "records", "/records"))
      .toBe(`/records?pages=2&legacy_activity=1#activity-records-${id}`);
    for (const pages of ["0", "-1", "1.5", "oops"]) expect(requestedPages(new URLSearchParams({ pages }))).toBe(1);
    expect(requestedPages(new URLSearchParams({ pages: "10000000" }))).toBe(250);
  });

});
