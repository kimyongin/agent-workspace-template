import { assert, assertEquals } from "@std/assert";
import { dataId, generateDataId } from "./data-id.ts";
Deno.test("날짜 ID는 한국 날짜·8자 영숫자를 사용하고 기존 UUID도 읽는다", () => {
  const value = generateDataId(new Date("2026-10-09T15:00:00Z"));
  assert(/^20261010-[A-Z0-9]{8}$/.test(value));
  assert(dataId.safeParse(value).success);
  assert(dataId.safeParse(crypto.randomUUID()).success);
  assertEquals(dataId.safeParse("20260230-ABCDEFGH").success, false);
  assertEquals(dataId.safeParse("20261010-abcdef12").success, false);
});
