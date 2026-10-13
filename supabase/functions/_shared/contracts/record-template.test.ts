import { assertEquals } from "@std/assert";
import {
  DEFAULT_RECORD_MEMO_TEMPLATES,
  effectiveRecordTemplate,
  recordTemplates,
  renderTemplate,
  simplifyTemplateSyntax,
  templateIssues,
} from "./record-template.ts";

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
  assertEquals(recordTemplates.safeParse({ entity: { update: { memo: "$변경항목$", tag_ids: [] } } }).success, false);
  assertEquals(
    recordTemplates.safeParse({ entity: { update: { memo: "$엔터티.이후.속성2$", tag_ids: [] } } }).success,
    false,
  );
  assertEquals(recordTemplates.safeParse({ entity: { create: { memo: "$없는변수$", tag_ids: [] } } }).success, false);
});

Deno.test("자료 종류 메모 null은 고정 문구이며 공통 자료 설정은 저장할 수 없다", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const value = { entity_types: { [id]: { update: { memo: null, tag_ids: [] } } } };
  assertEquals(recordTemplates.safeParse(value).success, true);
  assertEquals(
    effectiveRecordTemplate(recordTemplates.parse(value), "entity", "update", id).memo,
    DEFAULT_RECORD_MEMO_TEMPLATES.update,
  );
  assertEquals(recordTemplates.safeParse({ entity: { update: { memo: "old common", tag_ids: [] } } }).success, false);
  assertEquals(
    recordTemplates.safeParse({ entity_types: { [id]: { update: { memo: " ", tag_ids: [] } } } }).success,
    false,
  );
});

Deno.test("자료 종류의 사용자 문구는 실제 액션의 변수와 속성 키만 허용한다", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const check = (memo: string) =>
    recordTemplates.safeParse({ entity_types: { [id]: { create: { memo, tag_ids: [] } } } }).success;
  assertEquals(check("$엔터티.이후.prop_2$"), true);
  assertEquals(check("$엔터티.이전.prop_2$"), false);
  assertEquals(check("$없는변수$"), false);
  assertEquals(check("$엔터티.이후.속성2$"), false);
});
