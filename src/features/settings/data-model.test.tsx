import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataModelReview } from "./DataModelSettings.tsx";
import { createScopedApi } from "../../lib/api.ts";
const api = createScopedApi({ actorId: "fixture-actor", workspaceId: "fixture-space" });
vi.mock(
  "../../lib/supabase.ts",
  () => ({
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "fixture-actor" }, access_token: "fixture-token" } } }) },
    },
  }),
);

it("가져올 설정 검토는 충돌과 변환 필요를 구별하고 대상별 결과를 보여 준다", () => {
  const html = renderToStaticMarkup(
    <DataModelReview
      review={{
        fingerprint: "review",
        mode: "update",
        title: "오픈마켓",
        can_apply: false,
        mapping: { types: {}, rules: {}, relations: {}, properties: {} },
        items: [
          {
            ref: "order",
            label: "주문",
            kind: "migration_required",
            diff: [],
            message: "값 변환이 필요합니다",
          },
          {
            ref: "relation",
            label: "소속 주문",
            kind: "conflict",
            diff: [],
            message: "단일 관계에 여러 연결이 있습니다",
          },
        ],
      }}
    />,
  );
  expect(html).toContain("오픈마켓");
  expect(html).toContain("값 변환 필요");
  expect(html).toContain("단일 관계에 여러 연결이 있습니다");
  expect(html).not.toContain("설정 적용</button>");
});

it("전체 모델 미리보기는 요청 키 없는 읽기이며 원문을 그대로 보낸다", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ title: "검토" })),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await api("POST", "/data-model/preview", {
      document: '{"a":1,"a":2}',
      mode: "copy",
    });
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBeUndefined();
    expect(fetch.mock.calls[0][1].body).toContain('\\"a\\":1,\\"a\\":2');
  } finally {
    vi.unstubAllGlobals();
  }
});

it("신규 종류 검토는 실제 속성과 번호 설정 및 파일과 현재 설정의 연결 정보을 보여 준다", () => {
  const html = renderToStaticMarkup(
    <DataModelReview
      review={{
        fingerprint: "review",
        mode: "copy",
        title: "상품 모델",
        can_apply: true,
        mapping: {
          types: { product: "target-type" },
          properties: { product: { prop_9: "prop_2" } },
          rules: { "source-rule": "target-rule" },
          relations: { "source-relation": "target-relation" },
        },
        items: [{
          ref: "product",
          label: "상품",
          kind: "new",
          diff: [],
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            "x-type-id": "10000000-0000-4000-8000-000000000001",
            "x-version": 1,
            additionalProperties: false,
            title: "상품",
            properties: {
              prop_2: {
                type: "string",
                title: "판매상품명",
                "x-order": 1,
                "x-representative": true,
                default: "기본상품",
              },
            },
            required: ["prop_2"],
          },
          identity: {
            version: 1,
            label: "판매자상품번호",
            default_source: "coupang",
            sources: [{ code: "coupang", rule_id: "target-rule", active: false }],
          },
        }],
      }}
    />,
  );
  expect(html).toContain("파일과 현재 설정의 연결 정보");
  expect(html).toContain("prop_9");
  expect(html).toContain("prop_2");
  expect(html).toContain("source-rule");
  expect(html).toContain("target-rule");
  expect(html).toContain("판매상품명");
  expect(html).toContain("기본상품");
  expect(html).toContain("판매자상품번호");
  expect(html).toContain("coupang");
  expect(html).toContain("중지");
});
