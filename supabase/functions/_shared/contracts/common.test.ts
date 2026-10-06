import { assertEquals } from "@std/assert";
import { isoDate, recordBody, title } from "./common.ts";

Deno.test("제목은 앞뒤 공백 제거 후 코드 포인트 1~100자", () => {
  assertEquals(title.safeParse("  a  ").data, "a");
  assertEquals(title.safeParse("   ").success, false);
  assertEquals(title.safeParse("가".repeat(100)).success, true);
  assertEquals(title.safeParse("가".repeat(101)).success, false);
  // 이모지는 UTF-16 두 단위지만 한 글자로 센다.
  assertEquals(title.safeParse("😀".repeat(100)).success, true);
});

Deno.test("기록 본문은 원문 그대로 보존하고 Unicode 22,000자를 허용한다", () => {
  assertEquals(recordBody.parse("  본문\n"), "  본문\n");
  assertEquals(recordBody.safeParse("😀".repeat(22000)).success, true);
  assertEquals(recordBody.safeParse("가".repeat(22001)).success, false);
});

Deno.test("날짜는 실제로 있는 YYYY-MM-DD", () => {
  assertEquals(isoDate.safeParse("2026-02-28").success, true);
  assertEquals(isoDate.safeParse("2026-02-30").success, false);
  assertEquals(isoDate.safeParse("2026-2-1").success, false);
});
