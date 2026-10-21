import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { displayedProperty, PropertyFields, propertyValues } from "./property-fields.tsx";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
describe("schema form public presentation", () => {
  it("renders labels and three boolean states while preserving zero", () => {
    const definition = initialEntityDefinition("품명");
    definition.schema.properties.prop_2 = { "x-order": 20, type: ["boolean", "null"], title: "검사" };
    definition.schema.properties.prop_3 = { "x-order": 30, type: "number", title: "무게" };
    const html = renderToStaticMarkup(
      <PropertyFields
        definition={definition}
        values={{ prop_1: "제품", prop_3: "0" }}
        onChange={() => {}}
        errors={{}}
      />,
    );
    expect(html).toContain("품명");
    expect(html).toContain("미입력");
    expect(html).toContain("참");
    expect(html).toContain("거짓");
    expect(html).toContain('value="0"');
  });
});
it("nullable single-select distinguishes omitted input from its stored null choice", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = {
    "x-order": 40,
    type: ["string", "null"],
    oneOf: [{ const: "a" }, { const: null }],
  };
  const html = renderToStaticMarkup(
    <PropertyFields
      definition={definition}
      values={{ prop_1: "이름", prop_2: null }}
      onChange={() => {}}
      errors={{}}
    />,
  );
  expect(html).toContain('value="null" selected=""');
  expect(html).toContain('value="unset"');
  expect(html).not.toContain("미입력으로 변경");
});
it("archived arbitrary stored text cannot resolve inherited option labels", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { "x-order": 50, type: "string", title: "보관 메모" };
  definition.schema.properties.prop_2.deprecated = true;
  for (const value of ["__proto__", "constructor", "toString"]) {
    const html = renderToStaticMarkup(
      <PropertyFields
        definition={definition}
        values={{ prop_1: "이름", prop_2: value }}
        onChange={() => {}}
        errors={{}}
      />,
    );
    expect(html).toContain(value);
  }
});

it("property drafts reject a rounded numeric value while preserving the draft", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { "x-order": 60, type: "number", title: "수량" };
  const values = { prop_1: "이름", prop_2: "1.0000000000000001" };
  expect(() => propertyValues(definition, values)).toThrow();
  expect(values.prop_2).toBe("1.0000000000000001");
});

it("numeric draft failure reports the original field key for accessible form feedback", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { "x-order": 70, type: "number", title: "수량" };
  try {
    propertyValues(definition, { prop_1: "자료", prop_2: "1.0000000000000001" });
    throw new Error("must reject");
  } catch (error) {
    expect((error as { fields: Record<string, string> }).fields["properties.prop_2"]).toContain("정밀도");
  }
});

it("required empty inputs fail while optional null, zero and false remain distinct", () => {
  const definition = initialEntityDefinition("이름");
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 80, type: ["number", "null"] },
    prop_3: { "x-order": 90, type: ["boolean", "null"] },
  });
  expect(
    propertyValues(definition, { prop_1: "이름", prop_2: "0", prop_3: false }),
  )
    .toEqual({ prop_1: "이름", prop_2: 0, prop_3: false });
  expect(propertyValues(definition, { prop_1: "이름", prop_2: null })).toEqual({
    prop_1: "이름",
    prop_2: null,
  });
  expect(() => propertyValues(definition, { prop_1: null })).toThrow("값을 입력하세요");
  expect(() => propertyValues(definition, { prop_1: "" })).toThrow("1자 이상");
  expect(propertyValues(definition, { prop_1: "  " })).toEqual({ prop_1: "  " });
});

it("schema constraints reject invalid values beside the original field without changing drafts", () => {
  const definition = initialEntityDefinition("이름");
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 100, type: ["integer", "null"], minimum: 0, maximum: 100 },
    prop_3: { "x-order": 110, type: "string", minLength: 2, maxLength: 3 },
    prop_4: { "x-order": 120, type: ["string", "null"], oneOf: [{ const: "a" }, { const: null }] },
    prop_5: { "x-order": 130, type: "string", format: "date" },
  });
  for (
    const [key, value, message] of [
      ["prop_2", "101", "100 이하"],
      ["prop_2", "-1", "0 이상"],
      ["prop_3", "가", "2자 이상"],
      ["prop_3", "가나다라", "3자 이하"],
      ["prop_4", "missing", "선택"],
      ["prop_5", "2025-02-29", "날짜"],
      ["prop_5", "0000-02-29", "날짜"],
    ]
  ) {
    const draft = { prop_1: "자료", [key]: value };
    try {
      propertyValues(definition, draft);
      throw new Error("must reject");
    } catch (error) {
      expect((error as { fields: Record<string, string> }).fields["properties." + key]).toContain(message);
    }
    expect(draft[key]).toBe(value);
  }
  expect(
    propertyValues(definition, { prop_1: "자료", prop_2: "0", prop_3: "😀가", prop_4: null, prop_5: "2024-02-29" }),
  )
    .toEqual({ prop_1: "자료", prop_2: 0, prop_3: "😀가", prop_4: null, prop_5: "2024-02-29" });
});

it("read-only fields show their saved value without an editable input", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: "string", title: "고정 번호", "x-order": 20, readOnly: true };
  const html = renderToStaticMarkup(
    <PropertyFields
      definition={definition}
      values={{ prop_1: "자료", prop_2: "ABC" }}
      onChange={() => {}}
      errors={{}}
    />,
  );
  expect(html).toContain("고정 번호");
  expect(html).toContain("ABC");
  expect(html).not.toContain('value="ABC"');
});

it("keeps null branch labels and order distinct from the literal string null and missing input", () => {
  const definition = initialEntityDefinition("이름");
  const field = {
    type: ["string", "null"] as ["string", "null"],
    "x-order": 20,
    title: "진행 상태",
    oneOf: [{ const: "a", title: "진행" }, { const: null, title: "미정" }, { const: "null", title: "문자 코드" }],
  };
  definition.schema.properties.prop_2 = field;
  expect(displayedProperty(field, null, { null: "문자 별칭" })).toBe("미정");
  expect(displayedProperty(field, undefined)).toBe("미입력");
  expect(displayedProperty(field, "null")).toBe("문자 코드");
  const html = renderToStaticMarkup(
    <PropertyFields
      definition={definition}
      values={{ prop_1: "이름", prop_2: null }}
      onChange={() => {}}
      errors={{}}
    />,
  );
  expect(html).toContain('value="null" selected=""');
  expect(html).toContain('value="value:null"');
  expect(html.indexOf(">진행<")).toBeLessThan(html.indexOf(">미정<"));
  expect(html.indexOf(">미정<")).toBeLessThan(html.indexOf(">문자 코드<"));
});
it("required means presence while nullable null and unconstrained empty strings remain valid", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["string", "null"], "x-order": 20, default: null };
  definition.schema.properties.prop_3 = { type: "string", "x-order": 30 };
  definition.schema.required.push("prop_2", "prop_3");
  expect(propertyValues(definition, { prop_1: "이름", prop_2: null, prop_3: "" })).toEqual({
    prop_1: "이름",
    prop_2: null,
    prop_3: "",
  });
  expect(propertyValues(definition, { prop_1: "이름", prop_2: null, prop_3: "  " }).prop_3).toBe("  ");
  expect(propertyValues(definition, { prop_1: " ", prop_2: null, prop_3: "" })).toEqual({ prop_1: " ", prop_2: null, prop_3: "" });
});

it("keeps archived and readonly properties as named static values in the complete form", () => {
  const definition = initialEntityDefinition("품명");
  definition.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "입고량", readOnly: true };
  definition.schema.properties.prop_3 = { "x-order": 30, type: "boolean", title: "판매 여부", deprecated: true };
  const html = renderToStaticMarkup(
    <PropertyFields
      definition={definition}
      values={{ prop_1: "상품", prop_2: "0", prop_3: false }}
      onChange={() => {}}
      errors={{}}
    />,
  );
  expect(html).toContain("<dt>입고량");
  expect(html).toContain("읽기 전용");
  expect(html).toMatch(/<dd[^>]*>0<\/dd>/);
  expect(html).toContain("<dt>판매 여부");
  expect(html).toContain("보관");
  expect(html).toMatch(/<dd[^>]*>거짓<\/dd>/);
  expect(html).not.toContain('disabled=""');
});

it("renders a readonly title-participating attribute as ordinary key/value in edit", () => {
  const definition = initialEntityDefinition("품명");
  definition.schema.properties.prop_1.readOnly = true;
  const html = renderToStaticMarkup(
    <PropertyFields definition={definition} values={{ prop_1: "변경 불가 상품" }} onChange={() => {}} errors={{}} />,
  );
  expect(html).toMatch(/<dd[^>]*>변경 불가 상품<\/dd>/);
  expect(html).not.toContain("<h2");
  expect(html).toContain("읽기 전용");
  expect(html).not.toContain("<input");
});

it("validates title-participating text by its ordinary attribute constraints", () => {
  const definition = initialEntityDefinition("이름");
  expect(propertyValues(definition, { prop_1: " " })).toEqual({ prop_1: " " });
});
