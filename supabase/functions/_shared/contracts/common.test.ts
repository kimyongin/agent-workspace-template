import { assertEquals } from "@std/assert";
import { isoDate, summary, title } from "./common.ts";

Deno.test("제목은 앞뒤 공백 제거 후 코드 포인트 1~100자", () => {
  assertEquals(title.safeParse("  a  ").data, "a");
  assertEquals(title.safeParse("   ").success, false);
  assertEquals(title.safeParse("가".repeat(100)).success, true);
  assertEquals(title.safeParse("가".repeat(101)).success, false);
  // 이모지는 UTF-16 두 단위지만 한 글자로 센다.
  assertEquals(title.safeParse("😀".repeat(100)).success, true);
});

Deno.test("요약은 1~300자", () => {
  assertEquals(summary.safeParse("x".repeat(300)).success, true);
  assertEquals(summary.safeParse("x".repeat(301)).success, false);
});

Deno.test("날짜는 실제로 있는 YYYY-MM-DD", () => {
  assertEquals(isoDate.safeParse("2026-02-28").success, true);
  assertEquals(isoDate.safeParse("2026-02-30").success, false);
  assertEquals(isoDate.safeParse("2026-2-1").success, false);
});
