import { expect, test } from "@playwright/test";
import type { ModelChange } from "../supabase/functions/_shared/contracts/data-model.ts";
import type {
  EntitySchemaChange,
  MigrationPlan,
} from "../supabase/functions/_shared/contracts/entity-schema-change.ts";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
const source = initialEntityDefinition("상품명");
source.schema.properties.prop_2 = { type: "string", title: "수량", "x-order": 20 };
const target = structuredClone(source);
target.schema.properties.prop_2 = { type: "integer", title: "수량", "x-order": 20 };
const diff: EntitySchemaChange["diff"] = [{
  path: "properties.prop_2.type",
  kind: "migration_required",
  before: "string",
  before_present: true,
  after: "integer",
  after_present: true,
  reason: "자료 값 변환 필요",
  next_action: "convert",
}];
const initial: ModelChange = {
  id: "model-group",
  version: 1,
  status: "needs_conversion",
  created_at: "2026-10-17T00:00:00Z",
  result: null,
  review: {
    title: "재고 모델",
    mode: "update",
    fingerprint: "a".repeat(64),
    can_apply: false,
    mapping: { types: { product: "product-id" }, properties: {}, relations: {}, rules: {} },
    items: [{
      ref: "product",
      label: "상품",
      kind: "migration_required",
      diff,
      schema: target.schema,
      current_schema: source.schema,
      current_schema_version: 1,
      target_schema_version: 2,
    }],
  },
};
function analyzed(version: number, migration: MigrationPlan, failed = 0): ModelChange {
  return {
    ...initial,
    version,
    status: failed ? "needs_conversion" : "ready",
    group: {
      total: 2,
      processed: 2,
      failed,
      retryable: false,
      failure_reason: null,
      children: [{
        type_ref: "product",
        source,
        change: {
          id: "child-change",
          type_id: "product-id",
          source_schema_version: 1,
          source_template_fingerprint: "source",
          version,
          status: failed ? "invalid" : "ready",
          change_kind: "migration_required",
          edits: [],
          migration,
          executable: !failed,
          reservations: {},
          target,
          diff,
          fingerprint: "child",
          created_at: initial.created_at,
          updated_at: initial.created_at,
          analysis: {
            id: `analysis-${version}`,
            change_version: version,
            status: "succeeded",
            total: 2,
            processed: 2,
            failed,
            snapshot_fingerprint: "snapshot",
            definition_fingerprint: "definition",
            changed: 2,
            unchanged: 0,
            removed: 0,
            replacements: 0,
            retryable: false,
            failure_reason: null,
            errors: [],
            created_at: initial.created_at,
          },
        },
      }],
    },
  };
}
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
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { items: [], next_cursor: null } });
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

test("변환 규칙과 실패 행을 보완해 전체 분석 후 접수하고 진행 조회로 완료한다", async ({ page }, info) => {
  let model = structuredClone(initial), analyses = 0, queuedReads = 0;
  const writes: string[] = [];
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      expect(req.headers()["idempotency-key"]).toBeTruthy();
      writes.push(path);
      if (path.endsWith("/analyze")) {
        const body = req.postDataJSON();
        analyses++;
        expect(body.expected_version).toBe(model.version);
        expect(body.conversions[0].migration.rules).toEqual([{ op: "convert", key: "prop_2", to: "integer" }]);
        if (analyses === 2) {
          expect(body.conversions[0].migration.overrides).toEqual([{
            entity_id: "app:product-id:one",
            key: "prop_2",
            value: 4,
          }]);
        }
        model = analyzed(model.version + 1, body.conversions[0].migration, analyses === 1 ? 1 : 0);
      } else if (path.endsWith("/apply")) {
        expect(req.postDataJSON()).toEqual({ expected_version: model.version });
        model = { ...model, version: model.version + 1, status: "queued", group: { ...model.group!, processed: 0 } };
      }
      return route.fulfill({ json: model });
    }
    if (path.endsWith("/changes")) return route.fulfill({ json: { items: [model], next_cursor: null } });
    if (model.status === "queued" && ++queuedReads > 1) {
      model = {
        ...model,
        status: "applied",
        version: model.version + 1,
        result: {
          changed: true,
          type_ids: ["product-id"],
          relation_ids: [],
          counts: {
            types: { added: 0, updated: 1, unchanged: 0 },
            relations: { added: 0, updated: 0, unchanged: 0 },
            issuers: { added: 0, updated: 0, unchanged: 1 },
            rules: { added: 0, updated: 0, unchanged: 1 },
          },
        },
      };
    }
    return route.fulfill({ json: model });
  });
  await page.route(
    "**/api/entity-types/product-id/schema-changes/child-change/rows?**",
    (route) =>
      route.fulfill({
        json: {
          analysis_id: `analysis-${model.version}`,
          next_after: null,
          items: [{
            entity_id: "app:product-id:one",
            before: { prop_1: "볼펜", prop_2: "미정" },
            after: { prop_1: "볼펜", prop_2: "미정" },
            after_bytes: 30,
            changed: false,
            removed: 0,
            replacements: 0,
            errors: model.group?.failed ? [{ path: "properties.prop_2", message: "정수 입력이 필요합니다" }] : [],
          }],
        },
      }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "재고 모델 값 변환 필요", exact: true }).click();
  await page.getByRole("combobox", { name: "수량 변환 방식" }).selectOption("convert");
  await page.getByRole("button", { name: "변경 영향 확인", exact: true }).click();
  await expect(page.getByText("정수 입력이 필요합니다", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "보완값 지정", exact: true }).click();
  await page.getByRole("textbox", { name: "보완값", exact: true }).fill("4");
  await page.screenshot({ path: info.outputPath("group-correction.png"), fullPage: true });
  await page.getByRole("button", { name: "변경 영향 확인", exact: true }).click();
  await page.getByRole("button", { name: "검토한 설정 적용", exact: true }).click();
  await expect(page.getByText("요청한 작업을 진행하고 있습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "수량 변환 방식" })).toBeDisabled();
  await expect(
    page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^자료 종류$/ }) }).filter({
      has: page.locator("dd").filter({ hasText: /^추가 0개 · 수정 1개 · 변경 없음 0개$/ }),
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("group-applied.png"), fullPage: true });
  expect(writes).toEqual([
    "/api/data-model/changes/model-group/analyze",
    "/api/data-model/changes/model-group/analyze",
    "/api/data-model/changes/model-group/apply",
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("새로고침한 진행 작업은 읽기만 하고 실패 후 같은 그룹 재시도·취소를 제공한다", async ({ page }) => {
  let model: ModelChange = { ...analyzed(2, { rules: [], overrides: [] }), status: "preparing" };
  const writes: string[] = [];
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      writes.push(path);
      expect(req.postDataJSON()).toEqual({ expected_version: model.version });
      model = { ...model, version: model.version + 1, status: path.endsWith("/cancel") ? "cancelled" : "queued" };
      return route.fulfill({ json: model });
    }
    return route.fulfill({ json: path.endsWith("/changes") ? { items: [model], next_cursor: null } : model });
  });
  await page.route(
    "**/api/entity-types/**/rows?**",
    (route) => route.fulfill({ json: { items: [], next_after: null } }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "재고 모델 자료 값 변환 준비 중", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "수량 변환 방식" })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "재고 모델 자료 값 변환 준비 중", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "수량 변환 방식" })).toBeDisabled();
  expect(writes).toEqual([]);
  model = {
    ...model,
    version: 3,
    status: "failed",
    group: { ...model.group!, retryable: true, failure_reason: "작업을 다시 접수할 수 있습니다" },
  };
  await page.getByRole("button", { name: "값 변환 다시 시도", exact: true }).click();
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "재고 모델 취소됨", exact: true })).toBeVisible();
  expect(writes).toEqual(["/api/data-model/changes/model-group/retry", "/api/data-model/changes/model-group/cancel"]);
});

test("분석 접수 응답 유실은 변환안을 잠그고 같은 키·원래 보완 입력으로 재확인한다", async ({ page }) => {
  let model = initial;
  const writes: Array<{ key?: string; body: unknown }> = [];
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      writes.push({ key: req.headers()["idempotency-key"], body: req.postDataJSON() });
      if (writes.length === 1) return route.abort("failed");
      model = analyzed(2, req.postDataJSON().conversions[0].migration);
      return route.fulfill({ json: model });
    }
    return route.fulfill({ json: path.endsWith("/changes") ? { items: [model], next_cursor: null } : model });
  });
  await page.route(
    "**/api/entity-types/**/rows?**",
    (route) => route.fulfill({ json: { items: [], next_after: null } }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "재고 모델 값 변환 필요", exact: true }).click();
  await page.getByRole("combobox", { name: "수량 변환 방식" }).selectOption("convert");
  await page.getByRole("button", { name: "변경 영향 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다");
  await expect(page.getByRole("combobox", { name: "수량 변환 방식" })).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "검토한 설정 적용", exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test("변환 초안은 자료 설정 이동에서 보호하고 잘못된 숫자 보완을 그대로 유지한다", async ({ page }) => {
  const model = analyzed(2, { rules: [], overrides: [] }, 1);
  let writes = 0;
  await page.route("**/api/data-model/**", (route) => {
    if (route.request().method() === "POST") {
      writes++;
      return route.fulfill({ json: { ...model, version: 3, status: "cancelled" } });
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/changes")
        ? { items: [model], next_cursor: null }
        : model,
    });
  });
  await page.route(
    "**/api/entity-types/**/rows?**",
    (route) =>
      route.fulfill({
        json: {
          items: [{
            entity_id: "app:product-id:one",
            before: { prop_1: "볼펜", prop_2: "미정" },
            after: { prop_1: "볼펜", prop_2: "미정" },
            errors: [{ path: "properties.prop_2", message: "정수 필요" }],
          }],
          next_after: null,
        },
      }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "재고 모델 값 변환 필요", exact: true }).click();
  await page.getByRole("button", { name: "보완값 지정", exact: true }).click();
  await page.getByRole("textbox", { name: "보완값", exact: true }).fill("1.0000000000000001");
  await page.getByRole("button", { name: "변경 영향 확인", exact: true }).click();
  expect(writes).toBe(0);
  await expect(page.getByRole("textbox", { name: "보완값", exact: true })).toHaveValue("1.0000000000000001");
  await page.getByRole("tablist", { name: "자료 설정 항목", exact: true })
    .getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "보완값", exact: true })).toHaveValue("1.0000000000000001");
  await page.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "재고 모델 취소됨", exact: true })).toBeVisible();
  await page.getByRole("tablist", { name: "자료 설정 항목", exact: true })
    .getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
});

test("worker 준비 완료 상태는 규칙을 잠그고 GET 조회로 전체 확정을 기다린다", async ({ page }) => {
  let model: ModelChange = { ...analyzed(4, { rules: [], overrides: [] }), status: "ready_to_commit" };
  let writes = 0;
  await page.route("**/api/data-model/**", (route) => {
    const req = route.request();
    if (req.method() === "POST") writes++;
    return route.fulfill({
      json: new URL(req.url()).pathname.endsWith("/changes") ? { items: [model], next_cursor: null } : model,
    });
  });
  await page.route(
    "**/api/entity-types/**/rows?**",
    (route) => route.fulfill({ json: { items: [], next_after: null } }),
  );
  await page.goto("/settings/data-model");
  await page.getByRole("button", { name: "재고 모델 설정 적용 대기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "수량 변환 방식" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "검토한 설정 적용", exact: true })).toHaveCount(0);
  model = {
    ...model,
    version: 5,
    status: "applied",
    result: { type_ids: ["product-id"], relation_ids: [], changed: true },
  };
  await expect(page.getByText("적용 완료", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});
