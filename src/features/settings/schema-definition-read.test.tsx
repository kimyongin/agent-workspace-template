import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { SchemaChangeDiff } from "./SchemaChangeRead.tsx";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";

it("역사 입력 항목은 이름을 키와 결합해 한 번 읽고 0·거짓 기본값을 보존한다", () => {
  const definition = initialEntityDefinition("과거 상품명");
  definition.schema.properties.prop_2 = { type: "number", title: "과거 가격", "x-order": 20, minimum: 0, default: 0 };
  definition.schema.properties.prop_3 = { type: "boolean", title: "과거 판매 여부", "x-order": 30, default: false };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  expect(html).toContain("<dt>항목 이름</dt><dd>과거 가격</dd>");
  expect(html.match(/>과거 가격</g)).toHaveLength(1);
  expect(html).toContain("<dt>최소값</dt><dd>0</dd>");
  expect(html).toContain("<dt>생성 기본값</dt><dd>아니오</dd>");
});

it("reads a saved definition using option labels without exposing storage codes", () => {
  const definition = initialEntityDefinition("상품명");
  definition.schema.properties.prop_2 = {
    "x-order": 20,
    type: "string",
    title: "판매 상태",
    oneOf: [{ const: "available" }, { const: "closed" }],
    default: "available",
  };
  definition.schema.properties.prop_2 = {
    ...definition.schema.properties.prop_2,
    oneOf: Object.entries({ available: "판매 중", closed: "판매 종료" }).map(([value, title]) => ({
      const: value,
      title,
    })),
  };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  expect(html).toContain("판매 중, 판매 종료");
  expect(html).not.toContain("available");
  expect(html).not.toContain("closed");
});

it("preserves option values that share names with object prototype keys", () => {
  const definition = initialEntityDefinition("상품명");
  definition.schema.properties.prop_2 = {
    "x-order": 30,
    type: "string",
    oneOf: [{ const: "constructor" }, { const: "toString" }],
  };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  expect(html).toContain("constructor, toString");
});

it("does not reinterpret an older option using an unrelated current definition", () => {
  const target = initialEntityDefinition("상품명");
  target.schema.properties.prop_2 = {
    ...target.schema.properties.prop_2,
    oneOf: Object.entries({ ready: "판매 중" }).map(([value, title]) => ({ const: value, title })),
  };
  const current = {
    ...initialEntityDefinition("상품명"),
    type_id: "type",
    schema_version: 9,
    created_at: "2026-10-01T00:00:00Z",
  };
  current.schema.properties.prop_2 = {
    ...current.schema.properties.prop_2,
    oneOf: Object.entries({ ready: "현재의 다른 이름" }).map(([value, title]) => ({ const: value, title })),
  };
  const change = {
    source_schema_version: 1,
    target,
    diff: [{
      path: "properties.prop_2.oneOf",
      before: ["ready"],
      after: ["ready"],
      before_present: true,
      after_present: true,
      kind: "compatible",
    }],
  } as unknown as EntitySchemaChange;
  const html = renderToStaticMarkup(<SchemaChangeDiff change={change} definition={current} />);
  expect(html).toContain("ready");
  expect(html).toContain("판매 중");
  expect(html).not.toContain("현재의 다른 이름");
});

it("saved definition keeps the null branch title for defaults choices and examples", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = {
    type: ["string", "null"],
    "x-order": 20,
    title: "진행 상태",
    oneOf: [{ const: "a", title: "진행" }, { const: null, title: "미정" }, { const: "null", title: "문자 코드" }],
    default: null,
    examples: [null, "null"],
  };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  expect(html).toContain("<dt>생성 기본값</dt><dd>미정</dd>");
  expect(html).toContain("진행, 미정, 문자 코드");
  expect(html).toContain("미정, 문자 코드");
  expect(html).not.toContain("비워 두기");
  definition.schema.properties.prop_2.default = "null";
  expect(renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />)).toContain(
    "<dt>생성 기본값</dt><dd>문자 코드</dd>",
  );
});
