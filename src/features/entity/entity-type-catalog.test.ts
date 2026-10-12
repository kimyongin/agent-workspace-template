import { expect, test } from "vitest";
import type { EntityType } from "@contracts/entity-type.ts";
import { readEntityTypeCatalog } from "./entity-type-catalog.ts";

test("자료 종류 읽기는 마지막 페이지까지 보관 종류도 포함한다", async () => {
  const first = { id: "first", archived: false } as EntityType;
  const last = { id: "last", archived: true } as EntityType;
  const result = await readEntityTypeCatalog(new AbortController().signal, async (cursor) =>
    cursor ? { items: [last], next_cursor: null } : { items: [first], next_cursor: "page-two" });
  expect(result).toEqual([first, last]);
});

test("반복 커서는 완전한 목록으로 오인하지 않고 재시도할 수 있다", async () => {
  await expect(readEntityTypeCatalog(new AbortController().signal, async () =>
    ({ items: [], next_cursor: "repeated" }))).rejects.toThrow("끝까지 읽지 못했습니다");
  expect(await readEntityTypeCatalog(new AbortController().signal, async () =>
    ({ items: [], next_cursor: null }))).toEqual([]);
});

test("취소 후 늦게 도착한 페이지는 목록 결과로 반환하지 않는다", async () => {
  let finish!: (value: { items: EntityType[] }) => void;
  const controller = new AbortController();
  const late = new Promise<{ items: EntityType[] }>((resolve) => { finish = resolve; });
  const pending = readEntityTypeCatalog(controller.signal, () => late);
  controller.abort();
  finish({ items: [{ id: "old-account" } as EntityType] });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

test("중간 페이지 오류는 앞 페이지를 성공으로 반환하지 않는다", async () => {
  await expect(readEntityTypeCatalog(new AbortController().signal, async (cursor) => {
    if (cursor) throw new Error("조회 장애");
    return { items: [{ id: "partial" } as EntityType], next_cursor: "next" };
  })).rejects.toThrow("조회 장애");
});
