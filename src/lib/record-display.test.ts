import { expect, it } from "vitest";
import { recordDisplayText } from "@contracts/record-display.ts";
it("기록 목록의 대표 문구는 마크다운 본문에서 읽기 좋게 계산한다", () => {
  expect(recordDisplayText("# 상담 **결과**\n\n- [확인 자료](https://example.com)\n추가 내용")).toBe("상담 결과 확인 자료 추가 내용");
  expect(recordDisplayText("😀".repeat(100), 4)).toBe("😀😀😀😀…");
  expect(recordDisplayText("  \n ")).toBe("기록");
});
