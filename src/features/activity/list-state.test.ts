import { describe, expect, it, vi } from "vitest";
import {
  anchorId,
  appendItems,
  listReturnPath,
  listScope,
  type LoadedList,
  requestedPages,
  restoreList,
  safeListReturn,
} from "./list-state.ts";

describe("activity list return", () => {
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
      const unsafe of ["https://evil.invalid/tasks", "//evil.invalid/tasks", "/tasks/other", "/records", "/tasks\\x"]
    ) {
      expect(safeListReturn(unsafe, "tasks", "/tasks")).toBe("/tasks");
    }
    for (const pages of ["0", "-1", "1.5", "oops"]) expect(requestedPages(new URLSearchParams({ pages }))).toBe(1);
    expect(requestedPages(new URLSearchParams({ pages: "10000000" }))).toBe(250);
  });

  it("freshly replays pages and locates an anchor shifted by concurrent insertion", async () => {
    const publish = vi.fn();
    const load = vi.fn().mockResolvedValueOnce({ items: [{ id: "new" }], next_cursor: "second" })
      .mockResolvedValueOnce({ items: [{ id: "other" }], next_cursor: "third" })
      .mockResolvedValueOnce({ items: [{ id: "target" }], next_cursor: "fourth" });
    const result = await restoreList({ load, pages: 2, anchor: "target", current: () => true, publish });
    expect(load.mock.calls).toEqual([[undefined], ["second"], ["third"]]);
    expect(result?.pages).toBe(3);
    expect(result?.items.map((item: { id: string }) => item.id)).toEqual(["new", "other", "target"]);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("finishes at the end for a deleted/filtered target and retains partial pages on failure", async () => {
    const load = vi.fn().mockResolvedValue({ items: [{ id: "remaining" }], next_cursor: null });
    const result = await restoreList({ load, pages: 3, anchor: "deleted", current: () => true, publish: vi.fn() });
    expect(result?.pages).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    let last: LoadedList<{ id: string }> | undefined;
    const fail = vi.fn().mockResolvedValueOnce({ items: [{ id: "kept" }], next_cursor: "next" }).mockRejectedValueOnce(
      new Error("network"),
    );
    await expect(
      restoreList({
        load: fail,
        pages: 2,
        current: () => true,
        publish: (value: LoadedList<{ id: string }>) => {
          last = value;
        },
      }),
    ).rejects.toThrow("network");
    expect(last?.items).toEqual([{ id: "kept" }]);
  });

  it("ignores late responses after scope switch or unmount and stops a repeated cursor", async () => {
    let resolve!: (value: { items: { id: string }[]; next_cursor: null }) => void;
    let current = true;
    const publish = vi.fn();
    const pending = restoreList({
      load: () =>
        new Promise<{ items: { id: string }[]; next_cursor: null }>((done) => {
          resolve = done;
        }),
      pages: 1,
      current: () => current,
      publish,
    });
    current = false;
    resolve({ items: [{ id: "stale" }], next_cursor: null });
    expect(await pending).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    const repeated = vi.fn().mockResolvedValue({ items: [], next_cursor: "same" });
    await expect(restoreList({ load: repeated, pages: 4, current: () => true, publish })).rejects.toThrow(
      "Repeated list cursor",
    );
    expect(repeated).toHaveBeenCalledTimes(2);
    expect(appendItems([{ id: "a" }], [{ id: "a" }, { id: "b" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("bounds a missing anchor even when the server continually has more pages", async () => {
    let count = 0;
    const load = vi.fn(async () => ({ items: [{ id: String(++count) }], next_cursor: `cursor-${count}` }));
    const result = await restoreList({ load, pages: 2, anchor: "deleted", current: () => true, publish: vi.fn() });
    expect(load).toHaveBeenCalledTimes(7); // Saved extent plus at most five lookahead pages.
    expect(result?.next_cursor).toBe("cursor-7");
    expect(result?.items.some((item) => item.id === "deleted")).toBe(false);
  });
});
