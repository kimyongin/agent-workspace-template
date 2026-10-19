import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import type { ModelChange } from "@contracts/data-model.ts";
import { ModelGroupEditor } from "./ModelGroupEditor.tsx";
vi.mock("../../lib/api.ts", () => ({ createScopedApi: () => vi.fn() }));
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
  expect(html).toContain("변경 영향 확인");
  expect(html).toContain("상품명 변환 방식");
  expect(html).toContain("분석 전");
  expect(html).not.toContain("설정 적용</button>");
});

it.each([
  ["queued", "접수"],
  ["preparing", "준비 중"],
  ["ready_to_commit", "적용 준비 완료"],
  ["committing", "적용 중"],
  ["succeeded", "완료"],
  ["failed", "실패"],
  ["cancelled", "취소"],
] as const)("분석 정보가 없는 접수된 하위 작업 %s 상태를 표시한다", (status, label) => {
  const saved: ModelChange = {
    ...change,
    status: "cancelled",
    group: {
      total: 1, processed: 0, failed: 0, retryable: false, failure_reason: null,
      children: [{
        type_ref: "product", source: { schema },
        change: {
          id: "child", type_id: "product-id", source_schema_version: 1, source_template_fingerprint: "",
          version: 1, status: "draft", change_kind: "migration_required", edits: [], migration: { rules: [], overrides: [] },
          executable: false, reservations: {}, target: { schema }, diff: [], fingerprint: "", analysis: null,
          created_at: change.created_at, updated_at: change.created_at,
        },
        job: {
          id: "job", type_id: "product-id", type: { id: "product-id", label: "상품", icon_id: "box", archived: false },
          change_id: "child", change_version: 1, analysis_id: "analysis", fingerprint: "", source_schema_version: 1,
          version: 1, status, total: 1, processed: 0, retryable: status === "failed", failure_reason: null,
          result: null, source_expires_at: null, created_at: change.created_at, updated_at: change.created_at,
        },
      }],
    },
  };
  const html = renderToStaticMarkup(
    <ModelGroupEditor change={saved} onChange={() => {}} onState={() => {}} disabled={false} />,
  );
  expect(html).toContain(`${label} · 처리 0/1개`);
  expect(html).not.toContain("분석 전");
  saved.group!.children[0].change.analysis = {
    id: "analysis", change_version: 1, status: "succeeded", total: 1, processed: 1, failed: 0,
    changed: 1, unchanged: 0, removed: 0, replacements: 0, retryable: false, failure_reason: null,
    snapshot_fingerprint: "", definition_fingerprint: "", errors: [], created_at: change.created_at,
  };
  const analyzed = renderToStaticMarkup(
    <ModelGroupEditor change={saved} onChange={() => {}} onState={() => {}} disabled={false} />,
  );
  expect(analyzed).toContain(`${label} · 처리 0/1개 · 대상 1개 · 실패 0개`);
});
