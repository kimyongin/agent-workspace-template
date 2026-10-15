import { assertEquals } from "@std/assert";
import { recordCreate } from "./record.ts";
import { taskCreate } from "./task.ts";
import { changeNote } from "./change.ts";
Deno.test("body-only records and title/body tasks reject retired content", () => {
  assertEquals(recordCreate.safeParse({ body: "기록 내용" }).success, true);
  assertEquals(recordCreate.safeParse({ body: "" }).success, false);
  for (const field of ["title", "summary", "change_memo", "change_note"]) {
    assertEquals(recordCreate.safeParse({ body: "내용", [field]: "옛 입력" }).success, false);
  }
  for (
    const [schema, input] of [[taskCreate, { kind: "once", title: "할 일" }]] as const
  ) {
    assertEquals(schema.safeParse(input).success, true);
    assertEquals(schema.safeParse({ ...input, summary: "제거됨" }).success, false);
    assertEquals(schema.safeParse({ ...input, change_memo: {} }).success, false);
  }
  assertEquals(changeNote.parse("  입력 그대로\n"), "  입력 그대로\n");
  assertEquals(changeNote.safeParse("가".repeat(22000)).success, true);
  assertEquals(changeNote.safeParse("가".repeat(22001)).success, false);
});
