import { assertEquals } from "@std/assert";
import { recordTemplates, renderTemplate, simplifyTemplateSyntax, templateIssues } from "./record-template.ts";

Deno.test("한 글자 변수 구분자는 기존 구문·달러 리터럴과 호환되며 잘못된 변수를 거부한다", () => {
  const context = {
    target: "고객 $대상$",
    action: "update" as const,
    model: "entity" as const,
    changes: "기존 설명",
    changed_fields: ["prop_2"],
    before: { properties: { prop_2: 1 } },
    after: { properties: { prop_2: 2 } },
  };
  assertEquals(
    renderTemplate("$대상$ $액션$ ($변경항목$): $엔터티.이전.prop_2$ → $엔터티.이후.prop_2$ / $$10", context),
    "고객 $대상$ 수정 (prop_2): 1 → 2 / $10",
  );
  assertEquals(renderTemplate("${대상$} ${액션$}", context), "고객 $대상$ 수정");
  assertEquals(simplifyTemplateSyntax("${대상$} $액션$ / $$10"), "$대상$ $액션$ / $$10");
  assertEquals(templateIssues("$대상$ $$10", "entity", "create"), []);
  assertEquals(templateIssues("$대상", "entity", "create")[0].position, 1);
  assertEquals(
    recordTemplates.safeParse({ entity: { create: { memo: "$엔터티.이전.prop_2$", tag_ids: [] } } }).success,
    false,
  );
  assertEquals(recordTemplates.safeParse({ entity: { update: { memo: "$변경항목$", tag_ids: [] } } }).success, true);
  assertEquals(
    recordTemplates.safeParse({ entity: { update: { memo: "$엔터티.이후.속성2$", tag_ids: [] } } }).success,
    false,
  );
  assertEquals(recordTemplates.safeParse({ entity: { create: { memo: "$없는변수$", tag_ids: [] } } }).success, false);
});
