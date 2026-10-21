import { assertEquals } from "@std/assert";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { entityPresentationRow } from "../../functions/_shared/adapters/supabase/entity-values.ts";

Deno.test("entity read title composes stable property references and literals without changing values", () => {
  const { schema } = initialEntityDefinition("고객명");
  schema.properties.prop_2 = { type: "string", title: "지역", "x-order": 20 };
  schema["x-title-template"] = "$prop_1$ - $prop_2$";
  const properties = { prop_1: "초록상점", prop_2: "서울" };
  const row = {
    schema,
    id: "kind",
    type_id: "kind",
    label: "고객",
    icon_id: "box",
    schema_version: 1,
    external_id: "고객-1",
  };
  assertEquals(entityPresentationRow(row, properties).title, "초록상점 - 서울");
  assertEquals(properties, { prop_1: "초록상점", prop_2: "서울" });
});

Deno.test("entity title read formatting preserves scalar meanings, escapes and record-editor placeholder syntax", () => {
  const { schema } = initialEntityDefinition("고객명");
  schema.properties.prop_2 = { type: "boolean", "x-order": 20 };
  schema.properties.prop_3 = { type: "number", "x-order": 30 };
  schema.properties.prop_4 = {
    type: "string",
    "x-order": 40,
    oneOf: [{ const: "active", title: "진행 중" }, { const: null, title: "미정" }],
  };
  const row = { schema, id: "kind", label: "고객", icon_id: "box", schema_version: 1, external_id: "고객-1" };
  const read = (template: string, properties: Record<string, string | number | boolean | null>) => {
    schema["x-title-template"] = template;
    return entityPresentationRow(row, properties).title;
  };
  assertEquals(
    read("$prop_1$ / $prop_2$ / $prop_3$ / $prop_4$ / $$", {
      prop_1: "<상점>",
      prop_2: false,
      prop_3: 0,
      prop_4: "active",
    }),
    "<상점> / 아니오 / 0 / 진행 중 / $",
  );
  assertEquals(read("${prop_1$} $prop_4$", { prop_1: "초록", prop_4: null }), "초록 미정");
  assertEquals(read("$prop_1$", {}), "고객-1");
  assertEquals(read("$prop_1$", { prop_1: "\u3000\uFEFF\t\n" }), "고객-1");
  assertEquals(read(" $prop_1$ ", { prop_1: " 초록 " }), "  초록  ");
  assertEquals(read("고정 제목", {}), "고정 제목");
  schema.properties.prop_1.title = "바뀐 고객명";
  assertEquals(read("$prop_1$", { prop_1: "초록상점" }), "초록상점");
  schema["x-title-template"] = "";
  const before = structuredClone(schema);
  assertEquals(entityPresentationRow(row, { prop_1: "기존 제목" }).title, "고객-1");
  assertEquals(schema, before);
});

Deno.test("composed entity titles use the existing Unicode text budget without splitting emoji", () => {
  const { schema } = initialEntityDefinition("이름");
  schema["x-title-template"] = "$prop_1$ 끝";
  const row = { schema, id: "kind", label: "고객", icon_id: "box", schema_version: 1, external_id: "고객-1" };
  const title = entityPresentationRow(row, { prop_1: "😀".repeat(4096) }).title;
  assertEquals(title, "😀".repeat(4095) + "…");
});
