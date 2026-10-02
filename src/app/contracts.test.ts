import { expect, test } from "vitest";
import { title } from "@contracts/common.ts";

test("웹도 서버와 같은 contracts로 검증한다", () => {
  expect(title.safeParse("  할 일  ").data).toBe("할 일");
  expect(title.safeParse("").success).toBe(false);
});
