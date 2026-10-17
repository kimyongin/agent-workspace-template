import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { ModelChange } from "@contracts/data-model.ts";
import { ModelGroupEditor } from "./ModelGroupEditor.tsx";
vi.mock("../../lib/api.ts", () => ({ api: vi.fn() }));
const schema = initialEntityDefinition("상품명").schema;
const change: ModelChange = {
  id: "group",
  version: 1,
  status: "needs_conversion",
  created_at: "2026-10-17T00:00:00Z",
  result: null,
  review: {
    title: "전체 모델",
    mode: "update",
    fingerprint: "fingerprint",
    can_apply: false,
    mapping: { types: { product: "product-id" }, rules: {}, properties: {}, relations: {} },
    items: [{ ref: "product", label: "상품", kind: "migration_required", diff: [], schema, current_schema: schema }],
  },
};
it("저장한 전체 모델 이력 안에서 자료 종류별 변환 편집과 전체 분석을 제공한다", () => {
  const html = renderToStaticMarkup(
    <ModelGroupEditor change={change} onChange={() => {}} onState={() => {}} disabled={false} />,
  );
  expect(html).toContain("상품 변환");
  expect(html).toContain("전체 영향 분석");
  expect(html).toContain("상품명 변환 방식");
  expect(html).not.toContain("전체 적용</button>");
});
