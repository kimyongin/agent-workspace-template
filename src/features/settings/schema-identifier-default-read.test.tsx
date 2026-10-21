import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { APP_IDENTIFIER_RULE_ID } from "@contracts/entity-issuer.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";

it("identifier literal defaults show their human kind label and exact raw suffix", () => {
  const definition = initialEntityDefinition("이름"), kind = "10000000-0000-4000-8000-000000000001";
  definition.schema.properties.prop_3 = { type: "string", title: "판매 코드", "x-order": 30, default: kind + ":000é:한", "x-identifier": { allowed_kind_ids: [kind], default_kind_id: kind } };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} identifierKinds={[{ id: APP_IDENTIFIER_RULE_ID, label: "앱 번호" }, { id: kind, label: "판매 번호" }]} />);
  expect(html).toContain("판매 번호 · 000é:한");
  expect(html).not.toContain(kind + ":000é:한");
});

it("duplicate kind labels retain full UUID context even when their first eight characters match", () => {
  const definition = initialEntityDefinition("이름"), first = "10000000-0000-4000-8000-000000000001", second = "10000000-0000-4000-8000-000000000002";
  definition.schema.properties.prop_3 = { type: "string", title: "첫 코드", "x-order": 30, default: first + ":A:001", "x-identifier": { allowed_kind_ids: [first, second], default_kind_id: first } };
  definition.schema.properties.prop_4 = { type: "string", title: "둘째 코드", "x-order": 40, default: second + ":A:001", "x-identifier": { allowed_kind_ids: [first, second], default_kind_id: second } };
  const html = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} identifierKinds={[{ id: APP_IDENTIFIER_RULE_ID, label: "앱 번호" }, { id: first, label: "판매 번호" }, { id: second, label: "판매 번호" }]} />);
  expect(html).toContain(`판매 번호 (${first}) · A:001`);
  expect(html).toContain(`판매 번호 (${second}) · A:001`);
});
