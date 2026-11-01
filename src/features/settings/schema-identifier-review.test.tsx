import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { SchemaChangeDiff } from "./SchemaChangeRead.tsx";
import { SchemaVersionDiff } from "./SchemaVersionDiff.tsx";
import { schemaDiffValueLabel } from "./schema-labels.ts";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const kinds = [{ id: a, label: "마켓A · 상품 번호" }, { id: b, label: "마켓B · 상품 번호" }];

it("식별자 변경 검토에서 허용·기본 종류의 전후를 읽는다", () => {
  const definition = { ...initialEntityDefinition("상품명"), type_id: "type", schema_version: 1, created_at: "" };
  const before = { allowed_kind_ids: [a], default_kind_id: a };
  const after = { allowed_kind_ids: [a, b], default_kind_id: b };
  const change = {
    source_schema_version: 1,
    target: definition,
    diff: [{
      path: "properties.prop_2.x-identifier",
      before,
      after,
      before_present: true,
      after_present: true,
      kind: "compatible",
    }],
  } as unknown as EntitySchemaChange;
  const html = renderToStaticMarkup(
    <SchemaChangeDiff change={change} definition={definition} identifierKinds={kinds} />,
  );
  const text = new Window().document;
  text.body.innerHTML = html;
  expect(text.body.textContent).toContain(
    "허용: 마켓A · 상품 번호 · 기본: 마켓A · 상품 번호 → 허용: 마켓A · 상품 번호, 마켓B · 상품 번호 · 기본: 마켓B · 상품 번호",
  );
  expect(html).not.toContain("설정 변경");
});

it("관련 없는 빈 설정을 반복하지 않고 0·false·명시 null과 미설정을 보존한다", () => {
  const definition = initialEntityDefinition("상품명");
  definition.schema.properties.prop_3 = { type: "number", title: "가격", "x-order": 3, minimum: 0, default: 0 };
  definition.schema.properties.prop_4 = { type: "boolean", title: "검수", "x-order": 4, default: false };
  definition.schema.properties.prop_5 = { type: ["string", "null"], title: "메모", "x-order": 5, default: null };
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(<SchemaDefinitionRead definition={definition} />);
  const row = (name: string) => document.querySelector(`[aria-label="${name} 정의"]`)!;
  expect(row("상품명").textContent).not.toContain("허용 식별자 종류");
  expect(row("가격").textContent).not.toContain("최소 길이");
  expect(row("가격").textContent).toContain("최소값0");
  expect(row("가격").textContent).toContain("생성 기본값0");
  expect(row("검수").textContent).toContain("생성 기본값아니오");
  expect(row("메모").textContent).toContain("생성 기본값비워 두기");
  expect(row("상품명").textContent).toContain("생성 기본값미지정");
});

it("이름을 조회하지 못한 참조는 ID를 보존하고 중첩 허용·기본 종류 변경도 읽는다", () => {
  const definition = initialEntityDefinition("상품명");
  expect(schemaDiffValueLabel("properties.prop_2.x-identifier.allowed_kind_ids", [a, b], definition, kinds)).toBe(
    "마켓A · 상품 번호, 마켓B · 상품 번호",
  );
  expect(schemaDiffValueLabel("properties.prop_2.x-identifier.default_kind_id", b, definition, kinds)).toBe(
    "마켓B · 상품 번호",
  );
  expect(schemaDiffValueLabel("properties.prop_2.x-identifier.default_kind_id", b, definition)).toBe(
    `이름 확인 불가 (${b})`,
  );
});

it("독립 조회한 과거 버전도 출처 이름과 식별자 변경을 보존한다", () => {
  const before = {
    ...initialEntityDefinition("상품명"),
    type_id: "type",
    schema_version: 1,
    created_at: "",
    identifier_kinds: [{
      id: a,
      source: "A",
      source_label: "마켓A",
      label: "상품 번호",
      active: true,
      generation: "direct" as const,
      version: 1,
      source_version: 1,
    }],
  };
  before.schema.properties.prop_2["x-identifier"] = { allowed_kind_ids: [a], default_kind_id: a };
  const after = structuredClone(before);
  after.schema_version = 2;
  after.identifier_kinds.push({ ...after.identifier_kinds[0], id: b, source: "B", source_label: "마켓B" });
  after.schema.properties.prop_2["x-identifier"] = { allowed_kind_ids: [b], default_kind_id: b };
  const html = renderToStaticMarkup(
    <>
      <SchemaDefinitionRead definition={after} />
      <SchemaVersionDiff before={before} after={after} />
    </>,
  );
  expect(html).toContain("허용: 마켓A · 상품 번호 · 기본: 마켓A · 상품 번호");
  expect(html).toContain("허용: 마켓B · 상품 번호 · 기본: 마켓B · 상품 번호");
  expect(html).not.toContain("이름 확인 불가");
});
