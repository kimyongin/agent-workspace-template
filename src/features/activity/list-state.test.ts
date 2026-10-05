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
  it("batches long restoration renders while retaining every page and ordered cursor", async () => {
    const published: number[] = [];
    const load = vi.fn(async (cursor?: string) => {
      const index = Number(cursor ?? 0);
      return { items: [{ id: String(index) }], next_cursor: String(index + 1) };
    });
    const result = await restoreList({ load, pages: 250, current: () => true, publish: value => published.push(value.pages) });
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, ...Array.from({ length: 249 }, (_, i) => String(i + 1))]);
    expect(result?.items).toEqual(Array.from({ length: 250 }, (_, i) => ({ id: String(i) })));
    expect(result?.pages).toBe(250);
    expect(result?.next_cursor).toBe("250");
    expect(published).toEqual([1, ...Array.from({ length: 12 }, (_, i) => (i + 1) * 20), 250]);
  });

  it("flushes a partial render batch on failure but never publishes it after cancellation", async () => {
    for (const cancelled of [false, true]) {
      const published: number[] = [];
      let current = true;
      const load = vi.fn(async (cursor?: string) => {
        const index = Number(cursor ?? 0);
        if (index === 23) { current = !cancelled; throw new Error("network"); }
        return { items: [{ id: String(index) }], next_cursor: String(index + 1) };
      });
      await expect(restoreList({ load, pages: 250, current: () => current, publish: value => published.push(value.pages) })).rejects.toThrow("network");
      expect(published).toEqual(cancelled ? [1, 20] : [1, 20, 23]);
    }
  });

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

  it("uses the server search anchor page while preserving a finite restoration cap",async()=>{
    let count=0;
    const load=vi.fn(async()=>{count++;return {items:[{id:count===8?"target":String(count)}],next_cursor:`page-${count}`,anchor_page:count===1?8:null};});
    const result=await restoreList({load,pages:1,anchor:"target",current:()=>true,publish:vi.fn()});
    expect(load).toHaveBeenCalledTimes(8);expect(result?.items.at(-1)?.id).toBe("target");
    const entityPath=listReturnPath("entities",new URLSearchParams("keyword=한글&pages=2"),"00000000-0000-4000-8000-000000000001",10);
    expect(anchorId("entities",new URL(entityPath,"https://activity.invalid").hash)).toBe("00000000-0000-4000-8000-000000000001");
    expect(listScope(new URLSearchParams("create=1&q=명시&pages=2"))).toBe("q=%EB%AA%85%EC%8B%9C");
  });
});
