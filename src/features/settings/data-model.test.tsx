import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataModelReview } from "./DataModelSettings.tsx";
import { api } from "../../lib/api.ts";
vi.mock(
  "../../lib/supabase.ts",
  () => ({
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  }),
);

it("전체 모델 검토는 충돌과 변환 필요를 구별하고 대상별 결과를 보여 준다", () => {
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
  expect(html).not.toContain("전체 적용</button>");
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
