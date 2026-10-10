import { expect, test, vi } from "vitest";
import type { TagResult } from "@contracts/tag.ts";
import { createTagRead } from "./tag-read.ts";
const tag = (id: string, name: string): TagResult => ({
  id,
  name,
  scope: "record",
  version: 2,
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
});

test("태그 사전은 범위를 유지하며 마지막 페이지까지 읽는다", async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [tag("first", "첫 태그")], next_cursor: "한글 /+" })
    .mockResolvedValueOnce({ items: [tag("last", "마지막 태그")], next_cursor: null });
  const signal = new AbortController().signal;
  const reader = createTagRead(request);
  expect((await reader.all("record", signal)).map((value) => value.id)).toEqual(["first", "last"]);
  expect(request.mock.calls.map((call) => [call[0], call[1], call[3]])).toEqual([
    ["GET", "/tags?scope=record&limit=100", signal],
    ["GET", "/tags?scope=record&limit=100&cursor=%ED%95%9C%EA%B8%80%20%2F%2B", signal],
  ]);
});

test("태그 이름 대신 ID로 찾고 발견하면 남은 페이지를 읽지 않는다", async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [tag("other", "정정")], next_cursor: "next" })
    .mockResolvedValueOnce({ items: [tag("selected", "정정")], next_cursor: "unused" });
  expect((await createTagRead(request).find("record", "selected"))?.id).toBe("selected");
  expect(request).toHaveBeenCalledTimes(2);
});

test("삭제된 태그와 조회 오류를 구분한다", async () => {
  const missing = vi.fn().mockResolvedValue({ items: [], next_cursor: null });
  expect(await createTagRead(missing).find("record", "removed")).toBeNull();
  const failed = vi.fn().mockRejectedValue(new Error("조회 실패"));
  await expect(createTagRead(failed).find("record", "unknown")).rejects.toThrow("조회 실패");
});

test("태그 사전 조회는 취소된 늦은 페이지를 반환하거나 다음 페이지를 시작하지 않는다", async () => {
  let release!: (page: { items: TagResult[]; next_cursor: string }) => void;
  const request = vi.fn(() =>
    new Promise<{ items: TagResult[]; next_cursor: string }>((resolve) => {
      release = resolve;
    })
  );
  const controller = new AbortController();
  const pending = createTagRead(request).all("entity", controller.signal);
  controller.abort();
  release({ items: [tag("stale", "늦은 태그")], next_cursor: "next" });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(request).toHaveBeenCalledTimes(1);
});

test("태그 사전의 중간 페이지 실패는 불완전한 사전을 성공으로 반환하지 않는다", async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [tag("first", "첫 태그")], next_cursor: "next" })
    .mockRejectedValueOnce(new Error("두 번째 페이지 실패"));
  await expect(createTagRead(request).all("record")).rejects.toThrow("두 번째 페이지 실패");
});

test("같은 읽기 module의 동시 호출도 범위와 커서를 공유하지 않는다", async () => {
  const request = vi.fn(async (_method: string, path: string) => {
    const params = new URL(path, "https://example.test").searchParams;
    return { items: [tag(params.get("scope")!, "범위 태그")], next_cursor: null };
  });
  const reader = createTagRead(request);
  const [entities, records] = await Promise.all([reader.all("entity"), reader.all("record")]);
  expect(entities.map((tag) => tag.id)).toEqual(["entity"]);
  expect(records.map((tag) => tag.id)).toEqual(["record"]);
});
