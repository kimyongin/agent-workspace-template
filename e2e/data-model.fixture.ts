import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { expect, test } from "@playwright/test";
import type { ModelChange, ModelReview } from "../supabase/functions/_shared/contracts/data-model.ts";
const review: ModelReview = {
  title: "오픈마켓 모델",
  fingerprint: "a".repeat(64),
  mode: "update",
  can_apply: true,
  mapping: {
    types: { order: "order-id" },
    rules: {},
    relations: {},
    properties: {},
  },
  items: [{
    ref: "order",
    label: "주문",
    kind: "new",
    diff: [],
    message: "새 자료 종류",
  }, {
    ref: "relation",
    label: "주문의 주문품목",
    kind: "new",
    diff: [],
    message: "여러 개 연결",
  }],
};
const created: ModelChange = {
  id: "change-id",
  version: 1,
  status: "ready",
  review,
  result: null,
  created_at: "2026-10-17T00:00:00Z",
};
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: { full_name: "Fixture" },
};
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname.startsWith("/auth/v1/user")) {
      return route.fulfill({ json: user });
    }
    if (url.pathname === "/api/data-model/changes") {
      return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    return route.abort();
  });
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "ui-fixture",
          refresh_token: "ui-fixture",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      ),
    user,
  );
});

test(
  "가져올 설정 검토·변경안·전체 적용 및 결과와 파일 내보내기",
  async ({ page }, info) => {
    let applied = false;
    await page.route("**/api/data-model/**", (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.endsWith("/preview")) {
        expect(req.headers()["idempotency-key"]).toBeUndefined();
        expect(req.postDataJSON().document).toBe(
          '{"format":"workspace-data-model"}',
        );
        return route.fulfill({ json: review });
      }
      if (path.endsWith("/apply")) {
        expect(req.postDataJSON()).toEqual({ expected_version: 1 });
        expect(req.headers()["idempotency-key"]).toBeTruthy();
        applied = true;
        return route.fulfill({
          json: {
            ...created,
            version: 2,
            status: "applied",
            result: { type_ids: ["order-id"], relation_ids: ["relation-id"] },
          },
        });
      }
      if (path.endsWith("/change-id")) {
        return route.fulfill({
          json: applied
            ? {
              ...created,
              version: 2,
              status: "applied",
              result: { type_ids: ["order-id"], relation_ids: ["relation-id"] },
            }
            : created,
        });
      }
      if (path.endsWith("/export")) {
        return route.fulfill({
          json: { format: "workspace-data-model", format_version: 1 },
        });
      }
      return route.fulfill({
        json: req.method() === "POST" ? created : { items: [], next_cursor: null },
      });
    });
    await page.goto("/settings/data-model");
    await page.getByRole("textbox", { name: "설정 파일 내용" }).fill(
      '{"format":"workspace-data-model"}',
    );
    await page.getByRole("button", { name: "가져올 내용 검토" }).click();
    await expect(page.getByRole("button", { name: "검토 내용 저장" }))
      .toBeVisible();
    await page.getByRole("button", { name: "주문 추가", exact: true }).click();
    await expect(page.getByText("새 자료 종류", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("model-review.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "검토 내용 저장" }).click();
    await expect(page.getByRole("button", { name: "설정 적용", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "설정 적용", exact: true }).click();
    await expect(page.getByText("적용 완료", { exact: true })).toBeVisible();
    expect(applied).toBe(true);
    await expect(
      page.getByRole("link", { name: "연결 설정으로 이동", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("model-applied.png"),
      fullPage: true,
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "설정 내보내기" }).click();
    expect((await download).suggestedFilename()).toBe(
      "workspace-data-model.json",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  },
);

test("충돌은 적용을 막고 가져온 원문과 보완 경로를 보존한다", async ({ page }) => {
  await page.route(
    "**/api/data-model/preview",
    (route) =>
      route.fulfill({
        json: {
          ...review,
          can_apply: false,
          items: [{
            ref: "relation",
            label: "소속 주문",
            kind: "conflict",
            diff: [],
            message: "단일 관계에 연결이 여러 개 있습니다",
          }],
        },
      }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill("원문 보존");
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await expect(page.getByRole("button", { name: "검토 내용 저장" }))
    .toBeDisabled();
  await expect(page.getByRole("textbox", { name: "설정 파일 내용" }))
    .toHaveValue("원문 보존");
  await page.getByRole("button", { name: "소속 주문 충돌" }).click();
  await expect(page.getByText("단일 관계에 연결이 여러 개 있습니다"))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "설정 적용", exact: true }))
    .toHaveCount(0);
});

test("적용 응답이 유실돼도 입력을 잠그고 같은 키와 버전으로 재확인한다", async ({ page }) => {
  const writes: { body: unknown; key?: string }[] = [];
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.endsWith("/apply")) {
      writes.push({
        body: req.postDataJSON(),
        key: req.headers()["idempotency-key"],
      });
      if (writes.length === 1) return route.abort("failed");
      return route.fulfill({
        json: {
          ...created,
          version: 2,
          status: "applied",
          result: { type_ids: ["order-id"], relation_ids: [] },
        },
      });
    }
    return route.fulfill({ json: { items: [created], next_cursor: null } });
  });
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "오픈마켓 모델 적용 준비됨" }).click();
  await page.getByRole("button", { name: "설정 적용", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "저장 여부를 알 수 없습니다",
  );
  await expect(page.getByRole("textbox", { name: "설정 파일 내용" }))
    .toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })
    .click();
  await expect(page.getByText("적용 완료", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test("자료 설정으로 이동해도 미저장 전체 모델을 보호하고 취소하면 원문이 남는다", async ({ page }) => {
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill(
    "미저장 원문",
  );
  await page.getByRole("tablist", { name: "자료 설정 항목", exact: true })
    .getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" }))
    .toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "설정 파일 내용" }))
    .toHaveValue("미저장 원문");
});

test("파일의 중복 키 원문은 서버에 그대로 보내고 검증 실패 후에도 보존한다", async ({ page }) => {
  const raw = '{"title":"원본","title":"중복"}';
  await page.route("**/api/data-model/preview", (route) => {
    expect(route.request().postDataJSON().document).toBe(raw);
    return route.fulfill({
      status: 422,
      json: {
        code: "invalid_input",
        message: "중복 JSON 키입니다",
        fields: [{ path: "document.title", message: "title 키가 두 번 있습니다" }],
      },
    });
  });
  await page.goto("/settings/data-model");
  await page.locator('input[type="file"]').setInputFiles({
    name: "domain.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await expect(page.getByRole("textbox", { name: "설정 파일 내용" })).toHaveValue(raw);
  await expect(page.getByText("domain.json", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await expect(page.getByRole("alert")).toContainText("document.title: title 키가 두 번 있습니다");
  await expect(page.getByRole("textbox", { name: "설정 파일 내용" })).toHaveValue(raw);
});

test("화면 폭 전환은 모델 원문과 검토·펼침 상태를 보존한다", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.route("**/api/data-model/preview", (route) => route.fulfill({ json: review }));
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill("검토 원문");
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await page.getByRole("button", { name: "주문 추가", exact: true }).click();
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole("textbox", { name: "설정 파일 내용" })).toHaveValue("검토 원문");
    await expect(page.getByText("새 자료 종류", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "검토 내용 저장" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("변경 이력 더 보기는 다음 cursor를 읽고 실패해도 기존 행을 보존한다", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/data-model/changes**", (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("cursor")) return route.fulfill({ json: { items: [created], next_cursor: "next-page" } });
    expect(url.searchParams.get("cursor")).toBe("next-page");
    attempts++;
    if (attempts === 1) {
      return route.fulfill({ status: 503, json: { code: "internal", message: "다음 페이지 조회 실패" } });
    }
    return route.fulfill({
      json: { items: [{ ...created, id: "older", review: { ...review, title: "요리 모델" } }], next_cursor: null },
    });
  });
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await expect(page.getByText("다음 페이지 조회 실패")).toBeVisible();
  await expect(page.getByRole("button", { name: "오픈마켓 모델 적용 준비됨" })).toBeVisible();
  await page.getByRole("button", { name: "변경 이력 다시 읽기", exact: true }).click();
  await expect(page.getByRole("button", { name: "요리 모델 적용 준비됨" })).toBeVisible();
  await expect(page.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
});

test("변경안 저장 성공 후 상세 실패는 저장 성공을 유지하고 읽기만 다시 시도한다", async ({ page }) => {
  let writes = 0, reads = 0;
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.endsWith("/preview")) return route.fulfill({ json: review });
    if (req.method() === "POST") {
      writes++;
      return route.fulfill({ json: created });
    }
    if (path.endsWith("/change-id")) {
      reads++;
      if (reads === 1) return route.fulfill({ status: 503, json: { code: "internal", message: "상세 조회 실패" } });
      return route.fulfill({
        json: {
          ...created,
          review: { ...review, items: [{ ref: "detailed", label: "복원된 상세 검토", kind: "new", diff: [] }] },
        },
      });
    }
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill("모델 원문");
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByText("검토한 변경 내용을 저장했습니다.", { exact: false })).toBeVisible();
  await expect(page.getByText("상세 조회 실패", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "상세 다시 조회", exact: true }).click();
  await expect(page.getByRole("button", { name: "복원된 상세 검토 추가" })).toBeVisible();
  expect(writes).toBe(1);
  expect(reads).toBe(2);
});

test("낡은 원본과 세 버전을 구분하고 누락 속성의 명시 확인을 변경안에만 보낸다", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.endsWith("/preview")) {
      expect(req.postDataJSON()).not.toHaveProperty("remove_keys");
      return route.fulfill({
        json: {
          ...review,
          items: [{
            ...review.items[0],
            source_schema_version: 1,
            current_schema_version: 3,
            target_schema_version: 4,
            source_is_stale: true,
            removed_keys: ["prop_2"],
            current_schema: { properties: { prop_2: { title: "가격" } } },
            schema: { properties: {} },
          }],
        },
      });
    }
    if (req.method() === "POST") {
      writes++;
      expect(req.postDataJSON().remove_keys).toEqual({ order: ["prop_2"] });
      return route.fulfill({ json: created });
    }
    if (path.endsWith("/change-id")) return route.fulfill({ json: created });
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill("오래된 원본");
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await expect(page.getByRole("button", { name: "검토 내용 저장" })).toBeDisabled();
  await page.getByRole("button", { name: /주문.*항목 제거 확인/ }).click();
  for (const [key, value] of [["파일 원본 버전", "1"], ["현재 버전", "3"], ["적용 버전", "4"]]) {
    await expect(
      page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${key}$`) }) }).locator(
        "dd",
      ),
    ).toHaveText(value);
  }
  await expect(page.getByText("파일 원본 버전이 현재 적용 버전과 다릅니다.", { exact: false })).toBeVisible();
  await page.getByRole("checkbox", { name: "주문의 가격 항목 영구 제거 확인" }).check();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByText("검토한 변경 내용을 저장했습니다.", { exact: false })).toBeVisible();
  expect(writes).toBe(1);
});

for (const noOp of [true, false]) {
  test(`${noOp ? "변경 없음" : "부분 수정"} 결과는 탐색 대상 수와 실제 적용 수를 구분한다`, async ({ page }) => {
    const result: NonNullable<ModelChange["result"]> = {
      changed: !noOp,
      type_ids: ["type-1", "type-2", "type-3"],
      relation_ids: ["relation-1", "relation-2"],
      counts: {
        types: { added: 0, updated: noOp ? 0 : 1, unchanged: noOp ? 3 : 2 },
        relations: { added: noOp ? 0 : 1, updated: 0, unchanged: noOp ? 2 : 1 },
        issuers: { added: 0, updated: 0, unchanged: 1 },
        rules: { added: 0, updated: noOp ? 0 : 1, unchanged: noOp ? 2 : 1 },
      },
    };
    let change = created;
    await page.route("**/api/data-model/**", (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (path.endsWith("/preview")) return route.fulfill({ json: review });
      if (req.method() === "POST") {
        if (noOp || path.endsWith("/apply")) change = { ...created, status: "applied", result };
        return route.fulfill({ json: change });
      }
      if (path.endsWith("/change-id")) return route.fulfill({ json: change });
      return route.fulfill({ json: { items: [], next_cursor: null } });
    });
    await page.goto("/settings/data-model");
    await page.getByRole("textbox", { name: "설정 파일 내용" }).fill("검토할 모델");
    await page.getByRole("button", { name: "가져올 내용 검토" }).click();
    await page.getByRole("button", { name: "검토 내용 저장" }).click();
    if (noOp) {
      await expect(page.getByRole("button", { name: "오픈마켓 모델 변경 없음", exact: true })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "검토 이력만 보존" }).first()).toBeVisible();
    } else {
      await page.getByRole("button", { name: "설정 적용", exact: true }).click();
      await expect(
        page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^자료 종류$/ }) }).filter({
          has: page.locator("dd").filter({ hasText: /^추가 0개 · 수정 1개 · 변경 없음 2개$/ }),
        }),
      ).toBeVisible();
      await expect(
        page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^연결 설정$/ }) }).filter({
          has: page.locator("dd").filter({ hasText: /^추가 1개 · 수정 0개 · 변경 없음 1개$/ }),
        }),
      ).toBeVisible();
      await expect(
        page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^번호 출처$/ }) }).filter({
          has: page.locator("dd").filter({ hasText: /^추가 0개 · 수정 0개 · 변경 없음 1개$/ }),
        }),
      ).toBeVisible();
      await expect(
        page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^번호 종류$/ }) }).filter({
          has: page.locator("dd").filter({ hasText: /^추가 0개 · 수정 1개 · 변경 없음 1개$/ }),
        }),
      ).toBeVisible();
    }
    await expect(page.getByText("자료 종류 3개 · 관계 2개 적용", { exact: true })).toHaveCount(0);
  });
}

test("신규 종류의 실제 정의와 번호 및 원본 대응을 검토한다", async ({ page }, info) => {
  const schema = {
    ...initialEntityDefinition("판매상품명").schema,
    title: "주문",
    "x-type-id": "10000000-0000-4000-8000-000000000001",
    "x-version": 1,
  };
  const detailed: ModelReview = {
    ...review,
    mapping: {
      types: { order: schema["x-type-id"] },
      properties: { order: { prop_9: "prop_1" } },
      rules: { "20000000-0000-4000-8000-000000000001": "30000000-0000-4000-8000-000000000001" },
      relations: {},
    },
    items: [{
      ...review.items[0],
      source_type_id: "40000000-0000-4000-8000-000000000001",
      schema,
      identity: {
        version: 1,
        label: "판매자상품번호",
        default_source: "seller",
        sources: [{ code: "seller", rule_id: "30000000-0000-4000-8000-000000000001", active: false }],
      },
    }],
  };
  await page.route("**/api/data-model/preview", (route) => route.fulfill({ json: detailed }));
  await page.goto("/settings/data-model");
  await page.getByRole("textbox", { name: "설정 파일 내용" }).fill('{"format":"workspace-data-model"}');
  await page.getByRole("button", { name: "가져올 내용 검토" }).click();
  await page.getByRole("button", { name: "주문 추가", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "판매상품명 정의", exact: true }).locator("dd").filter({
      hasText: /^판매상품명$/,
    }),
  ).toBeVisible();
  await expect(page.getByText("판매자상품번호", { exact: true })).toBeVisible();
  await page.getByText("파일과 현재 설정의 연결 정보", { exact: true }).click();
  await expect(page.getByText("prop_9 → prop_1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("40000000-0000-4000-8000-000000000001 → 10000000-0000-4000-8000-000000000001", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("model-definition-mapping.png"), fullPage: true });
});

test("요약 이력을 다시 열면 독립 상세를 읽어 저장한 전체 변환 입력을 복원한다", async ({ page }) => {
  const schema = initialEntityDefinition("주문").schema;
  const summary: ModelChange = {
    ...created,
    status: "needs_conversion",
    review: {
      ...review,
      can_apply: false,
      items: [{ ref: "order", label: "주문", kind: "migration_required", diff: [] }],
    },
  };
  let reads = 0;
  await page.route("**/api/data-model/changes**", (route) => {
    expect(route.request().method()).toBe("GET");
    if (new URL(route.request().url()).pathname.endsWith("/change-id")) {
      reads++;
      return route.fulfill({
        json: {
          ...summary,
          review: { ...summary.review, items: [{ ...summary.review.items[0], schema, current_schema: schema }] },
        },
      });
    }
    return route.fulfill({ json: { items: [summary], next_cursor: null } });
  });
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "오픈마켓 모델 값 변환 필요", exact: true }).click();
  const group = page.getByRole("region", { name: "기존 자료 값 변환" });
  await expect(group.getByRole("button", { name: "주문 변환 분석 전", exact: true })).toBeVisible();
  const selector = group.getByLabel(`${schema.properties.prop_1.title} 변환 방식`);
  if (!await selector.isVisible()) await group.getByRole("button", { name: "주문 변환 분석 전", exact: true }).click();
  await expect(selector).toBeVisible();
  await expect(group.getByRole("button", { name: "변경 영향 확인", exact: true })).toBeEnabled();
  expect(reads).toBe(1);
});
