import { assertEquals } from "@std/assert";
import { recordCreate } from "./record.ts";
import { taskCreate } from "./task.ts";
import { principleCreate } from "./principle.ts";
import { changeNote } from "./change.ts";
Deno.test("body-only records and title/body tasks and principles reject retired content", () => {
  const id = crypto.randomUUID();
  assertEquals(recordCreate.safeParse({ id, body: "기록 내용" }).success, true);
  assertEquals(recordCreate.safeParse({ id, body: "" }).success, false);
  for (const field of ["title", "summary", "change_memo", "change_note"]) {
    assertEquals(recordCreate.safeParse({ id, body: "내용", [field]: "옛 입력" }).success, false);
  }
  for (
    const [schema, input] of [[taskCreate, { id, kind: "once", title: "할 일" }], [principleCreate, {
      id,
      title: "원칙",
    }]] as const
  ) {
    assertEquals(schema.safeParse(input).success, true);
    assertEquals(schema.safeParse({ ...input, summary: "제거됨" }).success, false);
    assertEquals(schema.safeParse({ ...input, change_memo: {} }).success, false);
  }
  assertEquals(changeNote.parse("  입력 그대로\n"), "  입력 그대로\n");
  assertEquals(changeNote.safeParse("가".repeat(22000)).success, true);
  assertEquals(changeNote.safeParse("가".repeat(22001)).success, false);
});
