import { expect, test, vi } from "vitest";
import type { SearchItem, SearchResult } from "@contracts/search.ts";
import { createSearchRead, searchAnchor } from "./search-read.ts";
const dated = "20261010-G123ABCD";
const row = (kind: SearchItem["kind"], id = dated): SearchItem => ({
  kind,
  id,
  title: kind,
  snippet: kind,
  snippet_start: 0,
  snippet_end: 1,
  at: "2026-10-10T00:00:00Z",
  tag_ids: [],
  match: "keyword",
  index_state: "pending",
  path: `/${kind}s/${id}`,
});
const page = (
  items: SearchItem[],
  next_cursor: string | null = null,
  anchor_page: number | null = null,
): SearchResult => ({
  items,
  next_cursor,
  anchor_page,
  search_state: "keyword_fallback",
  semantic_coverage: { pending: 3, excluded: 1 },
});

test("검색 복귀는 날짜 ID를 해석하고 종류가 다른 동일 ID와 검색 metadata를 보존", async () => {
  const load = vi.fn().mockResolvedValueOnce(page([row("task")], "next", 2)).mockResolvedValueOnce(
    page([row("record")], null),
  );
  const read = createSearchRead(new URLSearchParams("q=근거&mode=keyword"), load);
  await read.restore(1, `#search-record-${dated}`);
  expect(load.mock.calls[0][0].anchor).toEqual({ kind: "record", id: dated });
  expect(read.snapshot().page?.items.map((item) => item.kind)).toEqual(["task", "record"]);
  expect(read.snapshot().page?.semantic_coverage).toEqual({ pending: 3, excluded: 1 });
});

test("검색 복귀 anchor는 UUID·날짜 ID·인코딩 hash만 받고 잘못된 ID는 무시", () => {
  expect(searchAnchor("#search-task-00000000-0000-4000-8000-000000000001")).toEqual({
    kind: "task",
    id: "00000000-0000-4000-8000-000000000001",
  });
  expect(searchAnchor(`#search-record-${dated}`)).toEqual({ kind: "record", id: dated });
  expect(searchAnchor(`#${encodeURIComponent(`search-record-${dated}`)}`)).toEqual({ kind: "record", id: dated });
  expect(searchAnchor("#search-record-invalid")).toBeUndefined();
  expect(searchAnchor("#%broken")).toBeUndefined();
});

test("검색 복귀는 공통 목록의 250페이지 제한과 별도로 저장한 1,000페이지까지 읽는다", async () => {
  const load = vi.fn(async (input: { cursor?: string }) => {
    const number = Number(input.cursor ?? 0);
    return page([row("record", `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`)], String(number + 1));
  });
  const read = createSearchRead(new URLSearchParams("q=근거"), load);
  await read.restore(10000, "");
  expect(load).toHaveBeenCalledTimes(1000);
  expect(read.snapshot().page?.pages).toBe(1000);
  await read.restore(275, "");
  expect(read.snapshot().page?.pages).toBe(275);
  expect(read.snapshot().page?.items).toHaveLength(275);
});

test("검색 복귀 대상을 바꾸면 이전 읽기를 취소하고 늦은 결과를 무시", async () => {
  let finish!: (value: SearchResult) => void;
  const late = new Promise<SearchResult>((resolve) => {
    finish = resolve;
  });
  const load = vi.fn().mockReturnValueOnce(late).mockResolvedValueOnce(page([row("record")]));
  const read = createSearchRead(new URLSearchParams("q=근거"), load);
  const first = read.restore(1, `#search-task-${dated}`);
  await read.restore(1, `#search-record-${dated}`);
  finish(page([row("task")]));
  await first;
  expect(load.mock.calls[0][1].aborted).toBe(true);
  expect(load.mock.calls[1][0].anchor).toEqual({ kind: "record", id: dated });
  expect(read.snapshot().page?.items.map((item) => item.kind)).toEqual(["record"]);
});

test("권한 재확인은 이전 결과와 커서를 즉시 숨기고 거부 응답 뒤에도 복원하지 않는다", async () => {
  let reject!: (reason: Error) => void;
  const denied = new Promise<SearchResult>((_, fail) => { reject = fail; });
  const load = vi.fn().mockResolvedValueOnce(page([row("task")], "old-grant-cursor")).mockReturnValueOnce(denied);
  const read = createSearchRead(new URLSearchParams("q=근거"), load);
  await read.restore(1, "");
  const refresh = read.restart();
  expect(read.snapshot().page).toBeNull();
  expect(load.mock.calls[1][0]).not.toHaveProperty("cursor");
  reject(new Error("forbidden"));
  await refresh;
  expect(read.snapshot().page).toBeNull();
  expect(read.snapshot().error).toBeTruthy();
});
