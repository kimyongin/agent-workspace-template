import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { SchemaChangeDiff } from "./SchemaChangeRead.tsx";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";

it("reads a saved definition using option labels without exposing storage codes", () => {
  const definition = initialEntityDefinition("상품명");
  definition.schema.properties.prop_2 = {
    type: "string",
    title: "판매 상태",
    enum: ["available", "closed"],
    default: "available",
  };
  definition.display.order.push("prop_2");
  definition.display.option_labels.prop_2 = { available: "판매 중", closed: "판매 종료" };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  expect(html).toContain("판매 중, 판매 종료");
  expect(html).not.toContain("available");
  expect(html).not.toContain("closed");
});

it("does not reinterpret an older option using an unrelated current definition", () => {
  const target = initialEntityDefinition("상품명");
  target.display.option_labels.prop_2 = { ready: "판매 중" };
  const current = { ...initialEntityDefinition("상품명"), type_id: "type", schema_version: 9, created_at: "2026-10-01T00:00:00Z" };
  current.display.option_labels.prop_2 = { ready: "현재의 다른 이름" };
  const change = { source_schema_version: 1, target, diff: [{ path: "properties.prop_2.enum", before: ["ready"], after: ["ready"], before_present: true, after_present: true, kind: "compatible" }] } as unknown as EntitySchemaChange;
  const html = renderToStaticMarkup(<SchemaChangeDiff change={change} definition={current} />);
  expect(html).toContain("ready");
  expect(html).toContain("판매 중");
  expect(html).not.toContain("현재의 다른 이름");
});
