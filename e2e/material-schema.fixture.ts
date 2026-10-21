import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import { fulfillFixtureWorkspace, fixtureWorkspaceId } from "./support/workspace-scope.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { businessRows, disclosureContent, valueCell } from "./table-actions.ts";
import { chooseSetting } from "./settings-actions.ts";
import { fixtureSchema } from "./support/workspace-data.ts";
import { revealSetting } from "./ui-actions.ts";
import { expect, type Route, test } from "@playwright/test";
import { entityDetail } from "../supabase/functions/_shared/contracts/entity.ts";
import { type EntityType, initialEntityDefinition as baseDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
import type { EntitySchemaMigration } from "../supabase/functions/_shared/contracts/entity-schema-migration.ts";
// Keep ordinary prop_2..4 semantics separate from the selected identifier.
function initialEntityDefinition(label: string, metadata: Parameters<typeof baseDefinition>[1] = {}) {
  const definition = baseDefinition(label, { id: materials.id, title: materials.label, icon: materials.icon_id, ...metadata });
  definition.schema.properties.prop_5 = { ...definition.schema.properties.prop_2, "x-order": 50 };
  delete definition.schema.properties.prop_2;
  definition.schema["x-identity-property"] = "prop_5";
  definition.schema.required = ["prop_1", "prop_5"];
  return definition;
}
const type = (n: number, label: string, archived = false): EntityType => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  label,
  archived,
  icon_id: "leaf",
  schema_version: 1,
  next_property_number: 6,
  created_at: `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`,
  updated_at: "2026-10-12T00:00:00Z",
});
const materials = type(1, "재료"), products = type(2, "상품"), retired = type(3, "보관 자료", true);
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: { full_name: "Fixture" },
};
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, ...[materials, products, retired].map(type => ({ target_kind: "entity_type" as const, target_id: type.id, access: "write" as const }))])) return;
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname === "/api/entity-types") {
      return route.fulfill({
        json: { items: [materials, products, retired], next_cursor: null },
      });
    }
    const selected = [materials, products, retired].find((value) =>
      url.pathname.startsWith(`/api/entity-types/${value.id}`)
    );
    if (selected) {

      if (url.pathname.includes("/schema-changes/")) {
        return route.fulfill({
          json: {
            id: url.pathname.split("/").at(-1),
            type_id: selected.id,
            source_schema_version: 1,
            source_template_fingerprint: "fixture",
            version: 1,
            status: "draft",
            change_kind: "compatible",
            target: initialEntityDefinition("이름"),
            migration: { rules: [], overrides: [] },
            reservations: {},
            edits: [],
            diff: [],
            executable: false,
            fingerprint: "fixture",
            analysis: null,
            created_at: "2026-10-13T00:00:00Z",
            updated_at: "2026-10-13T00:00:00Z",
          },
        });
      }
      if (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes")) {
        return route.fulfill({ json: { items: [], next_before: null } });
      }
      return route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? { identifier_kinds: fixtureSchema.identifier_kinds,
            type: selected,
            type_id: selected.id,
            schema_version: 1,
            ...initialEntityDefinition("이름", { id: selected.id, title: selected.label, icon: selected.icon_id }),
          }
          : selected,
      });
    }
    if (await fulfillPreparation(route)) return;
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

const requestedVersion = (route: Route, current: number) =>
  Number(
    new URL(route.request().url()).searchParams.get("schema_version") ??
      current,
  );

const typeId = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const linkedChange = () => ({
  id: id(500),
  type_id: materials.id,
  source_schema_version: 1,
  source_template_fingerprint: "fixture",
  version: 1,
  status: "draft",
  change_kind: "compatible",
  target: initialEntityDefinition("이름"),
  migration: { rules: [], overrides: [] },
  reservations: {},
  edits: [],
  diff: [],
  executable: false,
  fingerprint: "fixture",
  analysis: null,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
});
const job = (
  n: number,
  status: EntitySchemaMigration["status"] = "succeeded",
  version = 1,
): EntitySchemaMigration => ({
  id: id(n),
  type_id: typeId,
  type: { id: typeId, label: `작업 ${n}`, icon_id: "leaf", archived: false },
  change_id: id(500),
  change_version: 1,
  analysis_id: id(501),
  fingerprint: "a".repeat(64),
  source_schema_version: 1,
  version,
  status,
  total: 10,
  processed: status === "succeeded" ? 10 : version,
  retryable: false,
  failure_reason: null,
  result: null,
  source_expires_at: null,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
});

test("작업 직접 링크와 작업 재선택에서도 기본 입력과 속성 펼침을 유지한다", async ({ page }) => {
  await page.route(
    "**/api/entity-schema-migrations?**",
    (route) => route.fulfill({ json: { items: [job(20), job(21)], next_before: null } }),
  );
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: job(
          Number(new URL(route.request().url()).pathname.split("-").at(-1)),
        ),
      }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill(
    "남길 기본 입력",
  );
  await page.getByRole("button", { name: "이름 입력 항목 편집", exact: true }).focus();
  await page.keyboard.press("Enter");
  const title = page.getByRole("region", { name: "이름 입력 항목", exact: true }).getByRole("textbox", { name: "항목 이름", exact: true });
  await expect(title).toHaveCount(1);
  await expect(title).toBeFocused();
  await title.fill("남길 속성 입력");
  await expect(page.getByRole("table", { name: "변경별 값 변환 실행 목록", exact: true })).toBeVisible();
  await page.getByRole("link", { name: / · 완료$/ }).and(
    page.locator(`a[href*="${id(21)}"]`),
  ).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "남길 기본 입력",
  );
  await expect(page.getByLabel("항목 이름", { exact: true }).first()).toHaveValue(
    "남길 속성 입력",
  );
  await expect(
    page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole(
      "status",
    ),
  ).toContainText(
    "완료",
  );
  await page.goBack();
  await expect(page.getByLabel("항목 이름", { exact: true }).first()).toHaveValue(
    "남길 속성 입력",
  );
});

test("실패 작업의 응답 불명 재시도는 같은 내용과 키로 확인하며 기본 입력을 보존한다", async ({ page }) => {
  const failed: EntitySchemaMigration = {
    ...job(20, "failed", 1), retryable: true, failure_reason: "임시 처리 실패",
  };
  const queued: EntitySchemaMigration = { ...job(21, "queued", 1), processed: 0 };
  const accepted = {
    job_id: queued.id, type_id: queued.type_id, change_id: queued.change_id,
    analysis_id: queued.analysis_id, job_version: 1, status: "queued",
  };
  let received = false, newReads = 0;
  const oldReads: EntitySchemaMigration[] = [];
  const requests: Array<{ body: unknown; key: string | undefined }> = [];
  await page.route("**/api/entity-schema-migrations?**", route => {
    expect(route.request().headers()["x-workspace-id"]).toBe(fixtureWorkspaceId);
    return route.fulfill({ json: { items: received ? [queued, failed] : [failed], next_before: null } });
  });
  await page.route("**/api/entity-schema-migrations/**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    expect(request.headers()["x-workspace-id"]).toBe(fixtureWorkspaceId);
    if (request.method() === "POST") {
      expect(path).toBe(`/api/entity-schema-migrations/${failed.id}/retry`);
      requests.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
      expect(requests.at(-1)!.body).toEqual({ expected_job_version: failed.version });
      received = true;
      if (requests.length === 1) return route.abort("failed");
      return route.fulfill({ status: 202, json: accepted });
    }
    if (path === `/api/entity-schema-migrations/${failed.id}`) {
      oldReads.push(structuredClone(failed));
      return route.fulfill({ json: failed });
    }
    expect(path).toBe(`/api/entity-schema-migrations/${queued.id}`);
    expect(received).toBe(true);
    newReads++;
    return route.fulfill({ json: queued });
  });
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("기본 초안");
  await page.getByRole("button", { name: "같은 작업 재시도", exact: true })
    .click();
  const historyToggle = page.getByRole("region", {
    name: "변경 이력",
    exact: true,
  }).getByRole("heading", { level: 2 })
    .getByRole("button");
  await historyToggle.click();
  await expect(historyToggle).toContainText("결과 확인 필요");
  await historyToggle.click();
  await page.getByRole("button", { name: "상태 다시 조회", exact: true }).click();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests[1]).toEqual(requests[0]);
  const selectedUrl = (jobId: string) => new URL(fixtureWorkspacePath(
    `/settings/entity-types/${materials.id}?job_id=${jobId}&change_id=${failed.change_id}`,
  ), page.url()).href;
  await expect(page).toHaveURL(selectedUrl(queued.id));
  await expect.poll(() => newReads).toBeGreaterThan(0);
  const detail = page.getByRole("region", { name: "값 변환 상세", exact: true });
  await expect(detail.getByRole("status")).toContainText("접수");
  await expect(detail.getByRole("status")).toContainText("0/10개 준비");
  const executions = page.getByRole("navigation", { name: "이 변경의 값 변환 이력", exact: true });
  await executions.getByRole("link", { name: / · 실패$/ }).click();
  await expect(page).toHaveURL(selectedUrl(failed.id));
  await expect(detail.getByRole("status")).toContainText("실패");
  expect(oldReads.length).toBeGreaterThan(0);
  for (const historical of oldReads) expect(historical).toEqual(failed);
  await executions.getByRole("link", { name: / · 접수$/ }).click();
  await expect(page).toHaveURL(selectedUrl(queued.id));
  await expect(detail.getByRole("status")).toContainText("접수");
  expect(requests).toHaveLength(2);
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "기본 초안",
  );
});

test("완료 작업에서 만든 원본 복구안은 같은 작업공간과 기본 초안을 유지한다", async ({ page }) => {
  const source = {
    ...job(20),
    source_expires_at: "2026-11-13T00:00:00Z",
    recovery: {
      status: "available",
      reason: null,
      current_schema_version: 1,
      conflicts: [],
    },
  };
  const recovered = {
    id: id(700),
    type_id: materials.id,
    version: 1,
    status: "draft",
    change_kind: "migration_required",
    target: initialEntityDefinition("복구 이름"),
    migration: { rules: [], overrides: [] },
    reservations: {},
    diff: [],
    analysis: null,
    source_schema_version: 1,
    source_template_fingerprint: "fixture",
    edits: [],
    executable: false,
    fingerprint: "fixture",
    created_at: materials.created_at,
    updated_at: materials.updated_at,
    recovery: {
      source_job_id: source.id,
      source_expires_at: source.source_expires_at,
    },
  };
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: route.request().method() === "POST" ? recovered : source,
      }),
  );
  await page.route(
    `**/api/entity-types/${materials.id}/schema-changes/${recovered.id}`,
    (route) => route.fulfill({ json: recovered }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${source.id}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill(
    "復帰する基本入力",
  );
  await page.getByRole("button", { name: "원본 복구안 만들기", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "복구안 원본", exact: true }))
    .toBeVisible();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "復帰する基本入力",
  );
  await page.getByRole("link", { name: "원본 작업 확인", exact: true }).click();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "復帰する基本入力",
  );
  await expect(page.getByRole("region", { name: "복구안 원본", exact: true }))
    .toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true }))
    .toBeVisible();
  await expect(
    page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole(
      "status",
    ),
  ).toContainText(
    "완료",
  );
});

test("변환 완료는 새 게시 속성을 바로 갱신하고 기본·속성·자료 번호 초안을 유지한다", async ({ page }) => {
  let complete = false;
  let definitionReads = 0;
  const original = initialEntityDefinition("이름");
  original.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "수량" };

  const published = initialEntityDefinition("이름");
  published.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "수량" };
  published.schema.properties.prop_3 = { "x-order": 30, type: "string", title: "게시된 추가값" };

  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith(`/schema-changes/${id(500)}`)) {
      return route.fulfill({ json: linkedChange() });
    }
    if (path.endsWith("/schema")) {
      definitionReads++;
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: requestedVersion(route, complete ? 2 : 1),
          ...(requestedVersion(route, complete ? 2 : 1) === 2 ? published : original),
        },
      });
    }
    if (path.endsWith("/schemas") || path.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [], next_before: null } });
    }
    return route.fulfill({
      json: {
        ...materials,
        version: complete ? 2 : 1,
        schema_version: complete ? 2 : 1,
      },
    });
  });
  await page.route("**/api/settings/business**", (route) =>
    route.fulfill({
      json: {
        settings: { record_templates: {} },
        versions: { record_templates: 0 },
      },
    }));
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: {
          ...job(20, complete ? "succeeded" : "preparing"),
          result: complete
            ? {
              schema_version: 2,
              total: 10,
              changed: 10,
              committed_at: "2026-10-14T00:00:00Z",
            }
            : null,
        },
      }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill(
    "남길 기본 입력",
  );
  await page.getByRole("button", { name: /^이름 항목 (?:펼치기|접기)$/, exact: true })
    .click();
  await page.getByLabel("항목 이름", { exact: true }).first().fill(
    "남길 속성 입력",
  );
  await page.getByRole("button", { name: /^수량 항목 (?:펼치기|접기)$/, exact: true })
    .click();
  await revealSetting(page.getByLabel("최소값", { exact: true }));
  await page.getByLabel("최소값", { exact: true }).fill("7.5");
  await page.getByRole("button", { name: "식별자 항목 펼치기", exact: true }).click();
  const record = page.getByRole("region", { name: / 입력 항목$/ }).filter({ has: page.getByLabel("기본 식별자 종류", { exact: true }) });
  await record.getByLabel("항목 이름", { exact: true }).fill("남길 자료 번호 입력");
  complete = true;
  await page.getByRole("button", { name: "상태 다시 조회", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole(
      "status",
    ),
  ).toContainText(
    "완료",
  );
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "남길 기본 입력",
  );
  await expect(page.getByLabel("항목 이름", { exact: true }).first())
    .toHaveValue("남길 속성 입력");
  await expect(record.getByLabel("항목 이름", { exact: true })).toHaveValue(
    "남길 자료 번호 입력",
  );
  await expect(
    page.getByRole("button", { name: /^게시된 추가값 항목 (?:펼치기|접기)$/, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("이전 최소값 입력", { exact: true }))
    .toHaveValue("7.5");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "현재 타입에서 사용할 수 없는 이전 조건 입력",
  );
  await page.getByRole("button", {
    name: "수량 이전 최소값 입력 제거",
    exact: true,
  }).click();
  await expect(page.getByLabel("이전 최소값 입력", { exact: true }))
    .toHaveCount(0);
  const refreshedReads = definitionReads;
  await page.getByRole("button", { name: "상태 다시 조회", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole(
      "status",
    ),
  ).toContainText(
    "완료",
  );
  expect(definitionReads).toBe(refreshedReads);
});

test("완료 작업의 최신 정의 조회 실패는 작업 결과와 초안을 유지하고 다시 조회한다", async ({ page }) => {
  let complete = false, failed = false;
  const published = initialEntityDefinition("갱신한 이름");
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith(`/schema-changes/${id(500)}`)) {
      return route.fulfill({ json: linkedChange() });
    }
    if (path.endsWith("/schema")) {
      if (
        complete && !failed &&
        !new URL(route.request().url()).searchParams.has("schema_version")
      ) {
        failed = true;
        return route.fulfill({
          status: 500,
          json: { code: "internal", message: "정의 조회 실패" },
        });
      }
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: requestedVersion(route, complete ? 2 : 1),
          ...(requestedVersion(route, complete ? 2 : 1) === 2 ? published : initialEntityDefinition("이름")),
        },
      });
    }
    if (path.endsWith("/schemas") || path.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [], next_before: null } });
    }
    return route.fulfill({
      json: {
        ...materials,
        version: complete ? 2 : 1,
        schema_version: complete ? 2 : 1,
      },
    });
  });
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: {
          ...job(20, complete ? "succeeded" : "preparing"),
          result: complete
            ? {
              schema_version: 2,
              total: 10,
              changed: 10,
              committed_at: "2026-10-14T00:00:00Z",
            }
            : null,
        },
      }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill(
    "실패 후 유지할 기본 입력",
  );
  complete = true;
  await page.getByRole("button", { name: "상태 다시 조회", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "값 변환은 완료되었습니다. 최신 입력 항목 조회에 실패",
  );
  const applied = page.getByRole("button", { name: /^입력 항목 변경 시각.*적용됨$/ });
  await expect(applied).toBeVisible();
  await expect(businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({ has: applied }).getByRole("cell").last()).toContainText("적용됨");
  await expect(page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole("status").getByRole("definition"))
    .toHaveText(["완료", "10/10개 준비"]);
  await page.getByRole("button", { name: "최신 입력 항목 다시 조회", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^갱신한 이름 항목 (?:펼치기|접기)$/, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "실패 후 유지할 기본 입력",
  );
  await expect(
    page.getByRole("button", { name: "최신 입력 항목 다시 조회", exact: true }),
  ).toHaveCount(0);
});

test("늦은 완료 작업 조회는 확인된 기본 정보와 다음 저장 버전을 되돌리지 않는다", async ({ page }) => {
  let saved = { ...materials, schema_version: 2 };
  let typeReads = 0, historyReads = 0;
  let release!: () => void, arrived!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const writes: any[] = [];
  await page.route(`**/api/entity-types/${materials.id}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith(`/schema-changes/${id(500)}`)) {
      return route.fulfill({ json: linkedChange() });
    }
    if (path.endsWith("/schema")) {
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: requestedVersion(route, saved.schema_version),
          ...initialEntityDefinition("이름"),
        },
      });
    }
    if (path.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [], next_before: null } });
    }
    if (path.endsWith("/schemas")) {
      historyReads++;
      return route.fulfill({
        json: {
          items: historyReads > 1
            ? [{
              type_id: materials.id,
              schema_version: 2,
              created_at: materials.created_at,
            }]
            : [],
          next_before: null,
        },
      });
    }
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      writes.push(body);
      saved = { ...saved, ...body, schema_version: saved.schema_version + 1 };
      return route.fulfill({ json: saved });
    }
    typeReads++;
    const snapshot = { ...saved };
    if (typeReads === 2) {
      arrived();
      await pending;
    }
    return route.fulfill({ json: snapshot });
  });
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: {
          ...job(20),
          result: { schema_version: 2, total: 10, changed: 10 },
        },
      }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await reading;
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  const name = page.getByLabel("자료 종류 이름", { exact: true });
  await name.fill("확인된 최신 이름");
  await page.getByRole("radio", { name: "책", exact: true }).check();
  await page.getByRole("button", { name: "기본 정보 저장", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "자료 종류를 저장했습니다." }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: /버전 2 · 적용됨$/ })).toBeVisible();
  await expect(name).toHaveValue("확인된 최신 이름");
  await expect(page.getByRole("radio", { name: "책", exact: true })).toBeChecked();
  await name.fill("다음 저장 이름");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "자료 종류를 저장했습니다." }),
  ).toBeVisible();
  expect(writes).toMatchObject([{
    label: "확인된 최신 이름",
    icon_id: "book",
  }, {
    label: "다음 저장 이름",
    icon_id: "book",
  }]);
});

test("완료 작업을 다시 선택하면 다른 작업을 보는 동안 게시된 정의와 기록 변수를 갱신한다", async ({ page }) => {
  let currentVersion = 1;
  let definitionReads = 0;
  const published = initialEntityDefinition("이름");
  published.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "다른 곳에서 게시한 값" };

  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith(`/schema-changes/${id(500)}`)) {
      return route.fulfill({ json: linkedChange() });
    }
    if (path.endsWith("/schema")) {
      definitionReads++;
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: requestedVersion(route, currentVersion),
          ...(requestedVersion(route, currentVersion) === 2 ? published : initialEntityDefinition("이름")),
        },
      });
    }
    if (path.endsWith("/schemas") || path.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [], next_before: null } });
    }
    return route.fulfill({
      json: {
        ...materials,
        version: currentVersion,
        schema_version: currentVersion,
      },
    });
  });
  await page.route("**/api/settings/business**", (route) =>
    route.fulfill({
      json: {
        settings: { record_templates: {} },
        versions: { record_templates: 0 },
      },
    }));
  await page.route(
    "**/api/entity-schema-migrations?**",
    (route) =>
      route.fulfill({
        json: { items: [job(20), job(21, "failed")], next_before: null },
      }),
  );
  await page.route("**/api/entity-schema-migrations/**", (route) => {
    const jobId = new URL(route.request().url()).pathname.split("-").at(-1);
    return route.fulfill({
      json: job(Number(jobId), Number(jobId) === 20 ? "succeeded" : "failed"),
    });
  });
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await expect.poll(() => definitionReads).toBeGreaterThanOrEqual(2);
  await page.getByRole("link", { name: / · 실패$/, exact: false }).click();
  await expect(
    page.getByRole("region", { name: "값 변환 상세", exact: true }).getByRole(
      "status",
    ),
  ).toContainText(
    "실패",
  );
  currentVersion = 2;
  await page.getByRole("link", { name: / · 완료$/ }).and(
    page.locator(`a[href*="${id(20)}"]`),
  ).click();
  await expect(
    page.getByRole("button", {
      name: /^다른 곳에서 게시한 값 항목 (?:펼치기|접기)$/,
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(fixtureWorkspacePath("/settings/records"));
  await chooseSetting(page, page.getByLabel("대상", { exact: true }), "재료");
  const record = page.getByRole("form", { name: "기록 자동 완성", exact: true });
  await record.getByLabel("변수 삽입", { exact: true }).click();
  await expect(page.getByRole("option").filter({ hasText: "다른 곳에서 게시한 값" })).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("새 게시 이력이 취소한 이전 페이지의 본문 읽기 오류는 숨기고 현재 조회 실패만 알린다", async ({ page }) => {
  let complete = false;
  const published = initialEntityDefinition("이름");
  published.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "확인한 새 속성" };

  await page.addInitScript((historyPath) => {
    const fetchResponse = window.fetch.bind(window);
    let held = false;
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      );
      const response = await fetchResponse(input, init);
      if (held || url.pathname !== historyPath || !url.searchParams.has("before")) return response;
      held = true;
      // Headers have arrived. Hold only this response's body read until the real request signal aborts it.
      response.text = () =>
        new Promise<string>((_resolve, reject) => {
          document.documentElement.dataset.fixtureHistoryBody = "pending";
          const aborted = () => {
            document.documentElement.dataset.fixtureHistoryBody = "aborted";
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          };
          if (init?.signal?.aborted) aborted();
          else init?.signal?.addEventListener("abort", aborted, { once: true });
        });
      return response;
    };
  }, `/api/entity-types/${materials.id}/schemas`);
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {

    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/schema-changes/${id(500)}`)) {
      return route.fulfill({ json: linkedChange() });
    }
    if (url.pathname.endsWith("/schema")) {
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: Number(
            url.searchParams.get("schema_version") ?? (complete ? 3 : 2),
          ),
          ...(Number(
              url.searchParams.get("schema_version") ?? (complete ? 3 : 2),
            ) === 3
            ? published
            : initialEntityDefinition("이름")),
        },
      });
    }
    if (url.pathname.endsWith("/schema-changes")) return route.fulfill({ json: { items: [], next_before: null } });
    if (url.pathname.endsWith("/schemas")) {
      if (url.searchParams.has("before")) {
        if (complete) {
          return route.fulfill({
            status: 500,
            json: { code: "internal", message: "현재 이전 게시 조회 실패" },
          });
        }
        return route.fulfill({
          json: {
            items: [{
              type_id: materials.id,
              schema_version: 1,
              created_at: materials.created_at,
            }],
            next_before: null,
          },
        });
      }
      return route.fulfill({
        json: {
          items: (complete ? [3, 2] : [2]).map((schema_version) => ({
            type_id: materials.id,
            schema_version,
            created_at: materials.created_at,
          })),
          next_before: 2,
        },
      });
    }
    return route.fulfill({
      json: {
        ...materials,
        version: complete ? 3 : 2,
        schema_version: complete ? 3 : 2,
      },
    });
  });
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) =>
      route.fulfill({
        json: {
          ...job(20, complete ? "succeeded" : "preparing"),
          result: complete ? { schema_version: 3, total: 10, changed: 10 } : null,
        },
      }),
  );
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${id(20)}`),
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", {
    name: "이전 적용 버전 더 보기",
    exact: true,
  }).click();
  await page.waitForFunction(() => document.documentElement.dataset.fixtureHistoryBody === "pending");
  complete = true;
  await page.getByRole("button", { name: "상태 다시 조회", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^확인한 새 속성 항목 (?:펼치기|접기)$/, exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => document.documentElement.dataset.fixtureHistoryBody === "aborted");
  await expect(page.getByRole("button", { name: /버전 3 · 적용됨$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /버전 1 · 적용됨$/ })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", {
    name: "이전 적용 버전 더 보기",
    exact: true,
  }).click();
  await expect(page.getByRole("alert")).toContainText(
    "현재 이전 게시 조회 실패",
  );
  await expect(
    page.getByRole("button", { name: /^확인한 새 속성 항목 (?:펼치기|접기)$/, exact: true }),
  ).toBeVisible();
});

test(
  "자료 설정의 실제 shell에서 속성과 화면 표시를 배치하고 긴 이름·배율·키보드를 유지한다",
  async ({ page }, info) => {
    const definition = initialEntityDefinition("재료명");
    Object.assign(definition.schema.properties, {
      prop_2: { "x-order": 20, type: "number", title: "수량" },
      prop_3: { "x-order": 30, type: "string", title: "단위", oneOf: [{ const: "kg" }, { const: "g" }] },
      prop_4: { "x-order": 40, type: "string", title: "표시 이름", minLength: 1 },
    });

    definition.schema.required.push("prop_4");


    await page.route(
      `**/api/entity-types/${materials.id}/schema`,
      (route) =>
        route.fulfill({
          json: { identifier_kinds: fixtureSchema.identifier_kinds,
            type: materials,
            type_id: materials.id,
            schema_version: 1,
            ...definition,
          },
        }),
    );
    await page.route("**/api/settings/business**", (route) =>
      route.fulfill({
        json: {
          settings: { record_templates: {} },
          versions: { record_templates: 0 },
        },
      }));
    await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}`));
    await expect(page.getByLabel("자료 종류 검색", { exact: true })).toHaveCount(0);
    await page.getByLabel("자료 종류 선택", { exact: true }).click();
    await expect(page.getByRole("option")).toContainText(["재료", "상품", "보관 자료"]);
    await page.keyboard.press("Escape");

    await page.screenshot({ path: info.outputPath("material-settings-toolbar.png"), fullPage: true });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const relation = page.getByRole("link", {
        name: "이 자료의 연결 설정",
        exact: true,
      });
      await expect(relation).toHaveAttribute("href", fixtureWorkspacePath(`/settings/relations?type_id=${materials.id}`));
      const relationBox = (await relation.boundingBox())!;
      expect(relationBox.width).toBeGreaterThanOrEqual(44);
      expect(relationBox.height).toBeGreaterThanOrEqual(44);
      const names = ["기본 정보", "입력 항목", "변경 이력"];
      const boxes = [];
      for (const name of names) {
        boxes.push((await page.getByRole("region", { name, exact: true }).boundingBox())!);
      }
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].y, `${width}px ${names[index]}`).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
      }
    }
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await page.getByRole("button", { name: /^수량 항목 (?:펼치기|접기)$/, exact: true })
      .click();
    const properties = page.getByRole("region", {
      name: "입력 항목",
      exact: true,
    });
    await expect(page.getByRole("region", { name: "화면 표시", exact: true }))
      .toHaveCount(0);
    const titleTemplate = properties.getByRole("textbox", { name: "제목 템플릿", exact: true });
    await expect(titleTemplate).toHaveText("재료명");
    await titleTemplate.fill("$prop_3$");
    await properties.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(titleTemplate).toHaveText("재료명");
    await expect(properties.getByRole("radio")).toHaveCount(0);
    await expect(
      properties.getByRole("button", { name: "변경 검토", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("table", { name: "입력 항목 목록", exact: true })).toHaveCount(1);
    await expect(properties.getByRole("table", { name: "입력 항목 목록", exact: true })).toBeVisible();
    const quantity = properties.getByRole("region", { name: "수량 입력 항목", exact: true });
    const quantityRow = properties.getByRole("row", { name: "수량 입력 항목", exact: true }).filter({ has: page.getByRole("button", { name: /^수량 항목 (?:펼치기|접기)$/ }) });
    const controlledQuantity = await disclosureContent(page, quantityRow.getByRole("button", { name: /^수량 항목 (?:펼치기|접기)$/ }));
    await expect(controlledQuantity.getByRole("textbox", { name: "항목 이름", exact: true })).toHaveValue("수량");
    const layout = await quantityRow.evaluate((el) => {
      const row = el.getBoundingClientRect();
      const details = el.nextElementSibling!.getBoundingClientRect();
      const buttons = [...el.querySelectorAll("[data-schema-order-actions] button, [data-schema-disclosure]")].map(
        (button) => ({
          x: button.getBoundingClientRect().x,
          right: button.getBoundingClientRect().right,
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        }),
      );
      return { rowBottom: row.bottom, detailsTop: details.top, detailsHeight: details.height, buttons };
    });
    expect(layout.detailsTop).toBeGreaterThanOrEqual(layout.rowBottom);
    expect(layout.detailsHeight).toBeGreaterThan(0);
    expect(layout.buttons).toHaveLength(3);
    expect(layout.buttons[0].right).toBeLessThanOrEqual(layout.buttons[1].x);
    expect(layout.buttons[1].right).toBeLessThanOrEqual(layout.buttons[2].x);
    for (const button of layout.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ["항목 추가", "변경 검토"]) {
      const bounds = await properties.getByRole("button", { name, exact: true }).boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
    }
    await quantity.getByText("추가 설정", { exact: true }).click();
    for (const label of await quantity.locator("label:has([role=checkbox])").all()) {
      const target = await label.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(quantityRow.getByRole("heading")).toBeVisible();
    const deletion = quantity.getByRole("button", { name: "항목 삭제", exact: true });
    await expect(deletion).toHaveAttribute("data-variant", "destructive");
    await quantity.getByText("추가 설정", { exact: true }).click();
    await page.getByRole("button", { name: "식별자 항목 펼치기", exact: true }).click();
    const record = page.getByRole("region", { name: / 입력 항목$/ }).filter({ has: page.getByLabel("기본 식별자 종류", { exact: true }) });
    await expect(record).toBeVisible();
    await expect(record.getByText("자료 식별자", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("identity-settings-flat.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "식별자 항목 접기", exact: true }).click();
    await page.screenshot({
      path: info.outputPath("property-display-settings.png"),
      fullPage: true,
    });
    const longPropertyName = "공백없이아주긴속성이름을입력해도화면너비를넘지않아야하는상황";
    await properties.getByLabel("항목 이름", { exact: true }).filter({
      visible: true,
    }).fill(longPropertyName);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    for (const width of [320, 390, 639, 640, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true);
      await expect(properties.getByRole("button", { name: /위로$/ }).first()).toBeVisible();
    }
    await properties.locator(
      "[role=\"row\"][aria-label$=\" 입력 항목\"] [data-schema-disclosure][aria-expanded=true]",
    ).focus();
    await page.keyboard.press("Enter");
    await expect(
      properties.getByLabel("항목 이름", { exact: true }).filter({
        visible: true,
      }),
    ).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.documentElement.style.setProperty("--display-scale", "1.5"));
      const collapsed = properties.getByRole("button", { name: /입력 항목 편집$/ });
      for (const trigger of await collapsed.all()) {
        const layout = await trigger.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const labels = [...button.querySelectorAll("span")].map(span => span.getBoundingClientRect());
          return { height: bounds.height, contained: labels.every(label => label.left >= bounds.left && label.right <= bounds.right + 1 && label.top >= bounds.top && label.bottom <= bounds.bottom + 1) };
        });
        expect(layout.height, `${width}px collapsed property target`).toBeGreaterThanOrEqual(44);
        expect(layout.contained, `${width}px collapsed title/badges`).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (width === 320) {
        const longSummary = properties.getByRole("button", { name: `${longPropertyName} 입력 항목 편집`, exact: true });
        await longSummary.scrollIntoViewIfNeeded();
        await expect(longSummary).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: info.outputPath("collapsed-properties-320-150.png"), fullPage: true });
      }
    }
    await page.screenshot({ path: info.outputPath("collapsed-properties-150.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.style.removeProperty("--display-scale"));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => document.documentElement.style.zoom = "2");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  },
);

test("변환을 접어도 같은 행에서 완료 버전으로 바뀌며 중복 버전·작업 구획을 만들지 않는다", async ({ page }) => {
  let complete = false;
  const current = initialEntityDefinition("재료명");
  const target = initialEntityDefinition("새 재료명");
  const planId = id(800), jobId = id(801);
  const change = () => ({
    id: planId,
    type_id: materials.id,
    source_schema_version: 1,
    source_template_fingerprint: "fixture",
    version: 1,
    status: complete ? "applied" : "ready",
    change_kind: "migration_required",
    target,
    migration: { rules: [], overrides: [] },
    reservations: {},
    edits: [],
    diff: [],
    executable: !complete,
    fingerprint: "a".repeat(64),
    analysis: null,
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
  });
  const execution = () => ({
    ...job(801, complete ? "succeeded" : "preparing", complete ? 2 : 1),
    change_id: planId,
    created_at: "2026-10-14T00:00:00Z",
    result: complete
      ? {
        schema_version: 2,
        total: 10,
        changed: 6,
        committed_at: "2026-10-15T00:00:00Z",
      }
      : null,
  });
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {

    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [change()], next_before: null } });
    }
    if (url.pathname.endsWith(planId)) return route.fulfill({ json: change() });
    if (url.pathname.endsWith("/schemas")) {
      return route.fulfill({
        json: {
          items: [
            ...(complete
              ? [{
                type_id: materials.id,
                schema_version: 2,
                created_at: "2026-10-15T00:00:00Z",
              }]
              : []),
            {
              type_id: materials.id,
              schema_version: 1,
              created_at: "2026-10-13T00:00:00Z",
            },
          ],
          next_before: null,
        },
      });
    }
    if (url.pathname.endsWith("/schema")) {
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: Number(
            url.searchParams.get("schema_version") ?? (complete ? 2 : 1),
          ),
          ...(Number(
              url.searchParams.get("schema_version") ?? (complete ? 2 : 1),
            ) === 2
            ? target
            : current),
        },
      });
    }
    return route.fulfill({
      json: {
        ...materials,
        version: complete ? 2 : 1,
        schema_version: complete ? 2 : 1,
      },
    });
  });
  await page.route(
    "**/api/entity-schema-migrations?**",
    (route) => route.fulfill({ json: { items: [execution()], next_before: null } }),
  );
  await page.route(
    `**/api/entity-schema-migrations/${jobId}`,
    (route) => route.fulfill({ json: execution() }),
  );
  await page.clock.install();
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}?change_id=${planId}&job_id=${jobId}`),
  );
  const row = businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({
    has: page.getByRole("button", { name: /값 변환 중 ·/ }),
  });
  const content = await disclosureContent(page, row.getByRole("button", { name: /값 변환 중 ·/ }));
  await expect(content.getByRole("button", { name: "변환 취소", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "폐기", exact: true }))
    .toHaveCount(0);
  await expect(page.getByRole("button", { name: "값 변환 시작", exact: true }))
    .toHaveCount(0);
  await expect(page.getByRole("heading", { name: "값 변환 작업", exact: true }))
    .toHaveCount(0);
  await expect(businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true }))).toHaveCount(2);
  await row.getByRole("button", { name: /값 변환 중 ·/ }).click();
  await expect(page.getByRole("button", { name: "변환 취소", exact: true })).toBeHidden();
  complete = true;
  await page.clock.fastForward(2000);
  const applied = page.getByRole("button", { name: /버전 2 · 적용됨$/ });
  await expect(applied).toHaveCount(1);
  await expect(applied).toHaveAttribute("aria-expanded", "false");
  await expect(businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true }))).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^최초 생성 시각/ })).toHaveCount(1);
  await applied.click();
  const conversion = page.getByRole("region", { name: "값 변환 상세", exact: true });
  for (const [label, value] of [["새 입력 항목 버전", "2"], ["적용", "10개 적용"], ["값 변경", "6개 값 변경"]]) {
    await expect(conversion.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) }).locator("..").getByRole("definition")).toHaveText(value);
  }
  await expect(page.getByRole("button", { name: "폐기", exact: true }))
    .toHaveCount(0);
  await expect(page.getByRole("button", { name: "값 변환 시작", exact: true }))
    .toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 적용", exact: true }))
    .toHaveCount(0);
});

test("적용 변경과 최초 생성은 한 목록에서 각 버전 정의와 고유 변경 결과를 보여준다", async ({ page }) => {
  const current = initialEntityDefinition("수정된 이름"),
    original = initialEntityDefinition("이름");
  const planId = id(900);
  const change = {
    id: planId,
    type_id: materials.id,
    source_schema_version: 1,
    version: 1,
    status: "applied",
    change_kind: "compatible",
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
  };
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {

    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [change], next_before: null } });
    }
    if (url.pathname.endsWith("/schemas")) {
      return route.fulfill({
        json: {
          items: [2, 1].map((n) => ({
            type_id: materials.id,
            schema_version: n,
            created_at: `2026-10-${13 + n}T00:00:00Z`,
          })),
          next_before: null,
        },
      });
    }
    if (url.pathname.endsWith("/schema")) {
      const version = Number(url.searchParams.get("schema_version") ?? 2);
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds,
          type_id: materials.id,
          schema_version: version,
          ...(version === 1 ? original : current),
        },
      });
    }
    return route.fulfill({
      json: { ...materials, schema_version: 2, version: 2 },
    });
  });
  await page.goto(
    fixtureWorkspacePath(`/settings/entity-types/${materials.id}/versions?schema_version=1`),
  );
  const history = page.getByRole("table", { name: "입력 항목 변경 이력", exact: true });
  await expect(history).toBeVisible();
  const rows = history.getByRole("row").filter({ has: page.getByRole("button", { name: /^(최초 생성|입력 항목 변경) 시각/ }) });
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("button", { name: /버전 2 · 적용됨$/ })).toHaveCount(1);
  const first = rows.filter({ has: page.getByRole("button", { name: /^최초 생성 시각/ }) });
  const trigger = first.getByRole("button", { name: /^최초 생성 시각/ });
  const panelId = await trigger.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const content = page.locator(`[id="${panelId}"]`);
  await expect(content.getByRole("region", { name: "변경 결과", exact: true })).toContainText("1 · 최초 생성");
  await expect(content.locator("input, select, textarea")).toHaveCount(0);
  await trigger.click();
  await expect(content).toBeHidden();
  await expect(page).not.toHaveURL(/schema_version=/);
  await page.getByRole("button", { name: /버전 2 · 적용됨$/ }).click();
  const differences = page.getByRole("table", { name: "버전 변경 목록", exact: true });
  await expect(differences).toBeVisible();
  await expect(differences.getByRole("row").filter({ has: page.getByText("수정된 이름", { exact: true }) }).filter({ hasText: "이름 → 수정된 이름" })).toBeVisible();
});

test("변환 목록 조회가 실패해도 페이지 밖 작업 직접 링크는 해당 행에서 읽는다", async ({ page }) => {
  await page.route(
    "**/api/entity-schema-migrations?**",
    (route) =>
      route.fulfill({
        status: 503,
        json: { code: "unavailable", message: "변환 목록 조회 실패" },
      }),
  );
  await page.route(
    `**/api/entity-schema-migrations/${id(31)}`,
    (route) => route.fulfill({ json: job(31, "failed") }),
  );
  await page.route(
    `**/api/entity-types/${materials.id}/schema-changes/${id(500)}`,
    (route) =>
      route.fulfill({
        json: {
          id: id(500),
          type_id: materials.id,
          source_schema_version: 1,
          version: 1,
          status: "ready",
          change_kind: "migration_required",
          target: initialEntityDefinition("변환 후 이름"),
          migration: { rules: [], overrides: [] },
          diff: [{
            path: "schema.properties.prop_1.title",
            before: "원본 이름",
            after: "변환 후 이름",
            before_present: true,
            after_present: true,
            kind: "compatible",
          }],
          reservations: {},
          edits: [],
          executable: true,
          fingerprint: "fixture",
          source_template_fingerprint: "fixture",
          analysis: null,
          created_at: "2026-10-13T00:00:00Z",
          updated_at: "2026-10-13T00:00:00Z",
        },
      }),
  );
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}?job_id=${id(31)}`));
  const detail = page.getByRole("region", {
    name: "값 변환 상세",
    exact: true,
  });
  await expect(detail.getByRole("status")).toContainText("실패");
  await expect(page.getByRole("region", { name: "변환 작업의 변경 내용", exact: true }).getByRole("table", { name: "변경안 차이 목록", exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "변환 작업의 변경 내용", exact: true }),
  ).toContainText(
    "원본 이름 → 변환 후 이름",
  );
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^이름 항목 (?:펼치기|접기)$/, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "변환 목록 조회 실패" }),
  ).toBeVisible();
  await expect(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true }).getByRole("row").filter({ has: page.getByRole("button", { name: /^입력 항목 변경 시각/ }) })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "변환 이력 다시 조회", exact: true }),
  ).toBeVisible();
});

test(
  "과거 버전 정의는 상수 경계값을 평평하게 표시하고 잘못된 응답을 재시도한다",
  async ({ page }, info) => {
    const original = initialEntityDefinition("재료명");
    const target = initialEntityDefinition("재료명");
    target.schema.properties.prop_1.maxLength = 20;
    target.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "재고", minimum: 0, default: 0 };
    target.schema.properties.prop_3 = { "x-order": 30, type: "boolean", title: "판매 가능", default: false };
    target.schema.properties.prop_4 = {
      "x-order": 40,
      type: "string",
      title: "단위",
      oneOf: [{ const: "kg" }, { const: "g" }],
      default: "kg",
    };
    target.schema.properties.prop_4.oneOf = Object.entries({ kg: "킬로그램", g: "그램" }).map(([value, title]) => ({
      const: value,
      title,
    }));


    target.schema.properties.prop_4.deprecated = true;
    let mismatch = true;
    await page.route(`**/api/entity-types/${materials.id}**`, (route) => {

      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/schemas")) {
        return route.fulfill({
          json: {
            items: [2, 1].map((n) => ({
              type_id: materials.id,
              schema_version: n,
              created_at: materials.created_at,
            })),
            next_before: null,
          },
        });
      }
      if (url.pathname.endsWith("/schema-changes")) return route.fulfill({ json: { items: [], next_before: null } });
      if (url.pathname.endsWith("/schema")) {
        const n = requestedVersion(route, 2);
        return route.fulfill({
          json: { identifier_kinds: fixtureSchema.identifier_kinds,
            type_id: materials.id,
            schema_version: mismatch && n === 1 ? 99 : n,
            ...(n === 1 ? original : target),
          },
        });
      }
      return route.fulfill({
        json: { ...materials, version: 2, schema_version: 2 },
      });
    });
    await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}`));
    const sections = ["기본 정보", "입력 항목", "변경 이력"];
    for (const name of sections) {
      const section = page.getByRole("region", { name, exact: true });
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading").first()).toContainText(name);
    }
    await page.getByRole("button", { name: /^변경 이력/ }).click();
    const row = businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({
      has: page.getByRole("button", { name: /버전 2 · 적용됨$/ }),
    });
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scale of ["100%", "200%"]) {
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = value;
        }, scale);
        const layout = await row.evaluate(el => {
          const cells = [...el.querySelectorAll<HTMLTableCellElement>(":scope > td")];
          const [title, date, status] = cells.slice(1).map(cell => cell.getBoundingClientRect());
          const bounds = el.getBoundingClientRect();
          const values = cells.slice(2).map(cell => cell.querySelector(":scope > div")!.getBoundingClientRect());
          return {
            reflowed: getComputedStyle(el).display === "grid",
            dateBelow: date.top >= title.bottom,
            statusSeparate: status.top >= date.bottom,
            labelsContained: [title, date, status].every(rect => rect.left >= bounds.left && rect.right <= bounds.right + 1),
            valueAxes: Math.abs(values[0].left - values[1].left),
            overflowPixels: el.scrollWidth - el.clientWidth,
          };
        });
        expect(layout.labelsContained, `${width}px ${scale}`).toBe(true);
        if (width <= 390) expect(layout.reflowed).toBe(true);
        if (width === 768 && scale === "100%") expect(layout.reflowed).toBe(false);
        if (layout.reflowed) {
          expect(layout).toMatchObject({ dateBelow: true, statusSeparate: true });
          expect(layout.valueAxes).toBeLessThan(1);
        } else expect(layout).toMatchObject({ dateBelow: false, statusSeparate: false });
        expect(layout.overflowPixels).toBeLessThanOrEqual(2);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    const content = await disclosureContent(page, row.getByRole("button", { name: /버전 2 · 적용됨$/ }));
    await row.getByRole("button", { name: /버전 2 · 적용됨$/ }).click();
    await expect(content.getByRole("alert")).toContainText("요청한 입력 항목 버전");
    await row.getByRole("button", { name: /버전 2 · 적용됨$/ }).click();
    await expect(page.getByRole("region", { name: "변경 이력", exact: true }).locator("h2").first().getByRole("button"))
      .toContainText("오류");
    mismatch = false;
    await row.getByRole("button", { name: /버전 2 · 적용됨$/ }).click();
    await expect(
      content.getByRole("region", { name: "입력 항목 정의", exact: true }),
    ).toBeVisible();
    const definition = content.getByRole("region", {
      name: "입력 항목 정의",
      exact: true,
    });
    await expect(definition.locator("input, select, textarea")).toHaveCount(0);
    await expect(definition).not.toContainText("prop_");
    await expect(
      definition.getByRole("row", { name: "재고 정의", exact: true }),
    ).toContainText("최소값0");
    await expect(
      definition.getByRole("row", { name: "판매 가능 정의", exact: true }),
    ).toContainText("아니오");
    await expect(definition.getByRole("row", { name: "단위 정의", exact: true })).toContainText("킬로그램");
    await expect(definition.getByRole("row", { name: "단위 정의", exact: true })).toContainText("그램");
    await expect((await valueCell(definition.getByRole("row", { name: "재고 정의", exact: true }), "사용 상태")).getByText("사용 중", { exact: true })).toBeVisible();
    await expect((await valueCell(definition.getByRole("row", { name: "단위 정의", exact: true }), "사용 상태")).getByText("사용 중지", { exact: true })).toBeVisible();
    await expect(definition).not.toContainText("(kg)");
    await expect(definition).not.toContainText("(g)");
    for (const heading of await definition.getByRole("heading").all()) await expect(heading).toBeVisible();
    for (
      const { width, fontSize, horizontal } of [
        { width: 768, fontSize: "100%", horizontal: true },
        { width: 320, fontSize: "200%", horizontal: false },
      ]
    ) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => document.documentElement.style.fontSize = value, fontSize);
      const pairs = await definition.locator("dl > div").evaluateAll((elements) =>
        elements.map((el) => {
          const key = el.querySelector("dt")!.getBoundingClientRect(),
            value = el.querySelector("dd")!.getBoundingClientRect(),
            bounds = el.getBoundingClientRect();
          return {
            keyLeft: key.left,
            keyRight: key.right,
            keyTop: key.top,
            keyBottom: key.bottom,
            valueLeft: value.left,
            valueRight: value.right,
            valueTop: value.top,
            left: bounds.left,
            right: bounds.right,
          };
        })
      );
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) {
        expect(pair.keyLeft).toBeGreaterThanOrEqual(pair.left - 1);
        expect(pair.valueRight).toBeLessThanOrEqual(pair.right + 1);
        if (horizontal) {
          expect(pair.keyRight).toBeLessThanOrEqual(pair.valueLeft + 1);
          expect(Math.abs(pair.keyTop - pair.valueTop)).toBeLessThanOrEqual(1);
        } else {
          expect(pair.keyBottom).toBeLessThanOrEqual(pair.valueTop + 1);
          expect(Math.abs(pair.keyLeft - pair.valueLeft)).toBeLessThanOrEqual(1);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await page.evaluate(() => document.documentElement.style.fontSize = "");
    await expect(content.getByRole("region", { name: "변경 결과", exact: true }))
      .toContainText("1 → 2");
    const result = content.getByRole("region", { name: "변경 결과", exact: true });
    await expect(result.getByRole("heading")).toHaveCount(1);
    await expect(result.getByRole("heading", { name: "변경 결과", exact: true })).toBeVisible();
    await expect(result.locator("strong")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("schema-history-presentation.png"),
      fullPage: true,
    });
  },
);

test("다른 완료 변경을 열면 버전과 해당 변환 작업을 함께 선택한다", async ({ page }) => {
  const jobs = [
    { ...job(20), result: { schema_version: 2, total: 10, changed: 10 } },
    { ...job(31), change_id: id(501), source_schema_version: 2, result: { schema_version: 3, total: 10, changed: 10 } },
  ];
  await page.route("**/api/entity-schema-migrations**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: url.pathname.endsWith("/entity-schema-migrations")
        ? { items: jobs, next_before: null }
        : jobs.find((j) => url.pathname.endsWith(j.id)),
    });
  });
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/schema-changes/")) {
      return route.fulfill({ json: { ...linkedChange(), id: url.pathname.split("/").at(-1), status: "applied" } });
    }
    if (url.pathname.endsWith("/schema-changes")) return route.fulfill({ json: { items: [], next_before: null } });
    if (url.pathname.endsWith("/schemas")) {
      return route.fulfill({
        json: {
          items: [3, 2, 1].map((schema_version) => ({
            type_id: materials.id,
            schema_version,
            created_at: materials.created_at,
          })),
          next_before: null,
        },
      });
    }
    if (url.pathname.endsWith("/schema")) {
      return route.fulfill({
        json: { identifier_kinds: fixtureSchema.identifier_kinds, type_id: materials.id, schema_version: requestedVersion(route, 3), ...initialEntityDefinition("이름") },
      });
    }
    return route.fulfill({ json: { ...materials, version: 3, schema_version: 3 } });
  });
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}?job_id=${id(20)}`));
  await page.getByRole("button", { name: /버전 3 · 적용됨$/ }).click();
  await expect(page).toHaveURL(new RegExp(`job_id=${id(31)}`));
  await expect(page).toHaveURL(/schema_version=3/);
  const row = businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({
    has: page.getByRole("button", { name: /버전 3 · 적용됨$/ }),
  });
  const content = await disclosureContent(page, row.getByRole("button", { name: /버전 3 · 적용됨$/ }));
  await expect(content.getByRole("region", { name: "값 변환 상세", exact: true })).toBeVisible();
  await expect(content.getByRole("region", { name: "변경 결과", exact: true })).toContainText("2 → 3");
});

test(
  "exports the current and historical documents without inventing historical metadata",
  async ({ page }, testInfo) => {
    const current = { identifier_kinds: fixtureSchema.identifier_kinds,
      ...initialEntityDefinition("재료명", { id: materials.id, title: "재료", icon: "leaf" }),
      type_id: materials.id,
      schema_version: 2,
      created_at: materials.created_at,
    };
    current.schema["x-version"] = 2;
    const historical = structuredClone(current) as any;
    historical.schema_version = 1;
    historical.schema["x-version"] = 1;
    delete historical.schema.title;
    delete historical.schema["x-icon"];
    delete historical.schema.deprecated;
    await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/schemas")) {
        return route.fulfill({
          json: {
            items: [2, 1].map((schema_version) => ({
              type_id: materials.id,
              schema_version,
              created_at: materials.created_at,
            })),
            next_before: null,
          },
        });
      }
      if (url.pathname.endsWith("/schema")) {
        return route.fulfill({ json: url.searchParams.get("schema_version") === "1" ? historical : current });
      }
      if (url.pathname === `/api/entity-types/${materials.id}`) {
        return route.fulfill({ json: { ...materials, schema_version: 2 } });
      }
      return route.fallback();
    });
    await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}?schema_version=1`));
    await expect(
      page.getByText("이 과거 버전에는 당시 종류 이름·아이콘·보관 상태가 기록되지 않았습니다.", { exact: true }),
    ).toBeVisible();
    const readDownload = async (name: string) => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name, exact: true }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^schema-.+-v[12]\.json$/);
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile((await download.path())!, "utf8"));
    };
    expect(await readDownload("현재 정의 JSON 내보내기")).toEqual(current.schema);
    expect(await readDownload("버전 1 JSON 내보내기")).toEqual(historical.schema);
    await page.screenshot({
      path: `/private/tmp/schema-document-web-qa/export-history-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await page.getByRole("button", { name: /^재료명 항목 (?:펼치기|접기)$/, exact: true }).click();
    await revealSetting(page.getByLabel("재료명 읽기 전용", { exact: true }));
    await page.getByLabel("재료명 읽기 전용", { exact: true }).check();
    await page.screenshot({
      path: `/private/tmp/schema-document-web-qa/field-editor-${testInfo.project.name}.png`,
      fullPage: true,
    });
  },
);

test("복구 충돌 대상 표는 기존 자료 링크·21개 제한·좁은 화면을 유지한다", async ({ page }) => {
  const source = { ...job(20), source_expires_at: "2026-11-13T00:00:00Z", recovery: { status: "conflict", reason: "이후 변경 확인 필요", current_schema_version: 1, conflicts: Array.from({ length: 22 }, (_, n) => ({ path: `entities.${materials.id}:${APP_IDENTIFIER_RULE_ID}:${id(70 + n)}`, message: `다른 사용자가 변경했습니다 ${n}` })) } };
  await page.route("**/api/entity-schema-migrations/**", route => route.fulfill({ json: source }));
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}/migrations/${source.id}`));
  const conflicts = page.getByRole("table", { name: "복구 충돌 대상 목록", exact: true });
  await expect(conflicts).toBeVisible();
  await expect(conflicts.getByRole("row")).toHaveCount(22);
  await expect(conflicts.getByRole("link")).toHaveCount(21);
  await expect(conflicts.getByRole("link").first()).toHaveAttribute("href", fixtureWorkspacePath(`/entities/${encodeURIComponent(`${materials.id}:${APP_IDENTIFIER_RULE_ID}:${id(70)}`)}`));
  await expect(conflicts.getByText("다른 사용자가 변경했습니다 20", { exact: true })).toBeVisible();
  await expect(conflicts.getByText("다른 사용자가 변경했습니다 21", { exact: true })).toHaveCount(0);
  await expect(page.getByText("한 번에 최대 21개 사유를 표시합니다.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await conflicts.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


for (const mode of ["editor", "history"] as const) {
  test(`자료별 검토 오류 표 ${mode}: 긴 자료 번호·모든 사유·좁은 배율을 보존한다`, async ({ page }, info) => {
    const number = "긴자료번호-".repeat(30);
    const first = `crm:${id(9)}:${number}`;
    const current = { ...linkedChange(), status: "invalid", analysis: {
      id: id(501), status: "succeeded", total: 2, processed: 2, failed: 2,
      change_version: 1, snapshot_fingerprint: "fixture", definition_fingerprint: "fixture",
      changed: 0, unchanged: 0, removed: 0, replacements: 0,
      retryable: false, failure_reason: null, created_at: "2026-10-13T00:00:00Z",
      errors: [
        { entity_id: first, fields: [{ path: "properties.prop_1.required", message: "필수 값을 입력하세요" }, { path: "properties.prop_1.maxLength", message: "허용 길이를 초과했습니다" }] },
        { entity_id: "이전형식-자료번호", fields: [{ path: "properties.prop_1.type", message: "문자열 값이 필요합니다" }] },
      ],
    } };
    const writes: string[] = [];
    await page.route(`**/api/entity-types/${materials.id}/schema-changes**`, route => {
      if (route.request().method() !== "GET") writes.push(route.request().method());
      if (new URL(route.request().url()).pathname.endsWith("/rows")) return route.fulfill({ json: { analysis_id: id(501), items: [], next_after: null } });
      return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/schema-changes") ? { items: [current], next_before: null } : current });
    });
    await page.route("**/api/entity-schema-migrations**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(id(20)) ? job(20) : { items: [job(20)], next_before: null } }));
    await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}?${mode === "editor" ? `change_id=${id(500)}` : `job_id=${id(20)}`}`));
    const owner = mode === "editor" ? page : page.getByRole("region", { name: "변환 작업의 변경 내용", exact: true });
    const results = owner.getByRole("button", { name: mode === "editor" ? "자료별 결과" : "검토 결과", exact: true });
    await revealSetting(results);
    await results.click();
    const table = owner.getByRole("table", { name: "자료별 검토 문제", exact: true });
    await expect(table).toBeVisible();
    const rows = businessRows(table);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole("cell").nth(0)).toHaveText(`crm · ${number}`);
    await expect(rows.nth(1).getByRole("cell").nth(0)).toHaveText("이전형식-자료번호");
    await expect(rows.nth(0).getByRole("listitem")).toHaveText(["이름 · 필수 입력: 필수 값을 입력하세요", "이름 · 최대 길이: 허용 길이를 초과했습니다"]);
    await expect(rows.nth(1).getByRole("listitem")).toHaveText(["이름 · 타입: 문자열 값이 필요합니다"]);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.documentElement.style.fontSize = "200%");
      const bounds = await table.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
      expect(bounds.scroll, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(rows).toHaveCount(2);
    }
    await table.screenshot({ path: info.outputPath(`review-errors-${mode}.png`) });
    expect(writes).toEqual([]);
  });
}

test("schema default date calendar edits only the retained definition draft", async ({ page }) => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { "x-order": 20, type: "string", format: "date", title: "확인 날짜", default: "2024-02-29" };
  await page.route(`**/api/entity-types/${materials.id}/schema`, (route) => route.fulfill({
    json: { identifier_kinds: fixtureSchema.identifier_kinds, ...definition, type: materials, type_id: materials.id, schema_version: 1 },
  }));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(request.method());
  });
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${materials.id}`));
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^확인 날짜 항목 펼치기$/, exact: true }).click();
  const field = page.getByRole("region", { name: "확인 날짜 입력 항목", exact: true });
  await field.getByRole("button", { name: "추가 설정", exact: true }).click();
  const input = field.getByLabel("기본값", { exact: true });
  await expect(input).toHaveValue("2024-02-29");
  await field.getByRole("button", { name: "확인 날짜 기본값 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "확인 날짜 기본값 달력", exact: true });
  await calendar.getByRole("gridcell", { selected: true }).getByRole("button").press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(input).toHaveValue("2024-03-01");
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(input).toHaveValue("2024-03-01");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await field.getByRole("button", { name: "확인 날짜 기본값 달력 열기", exact: true }).click();
  await expect(calendar.getByRole("grid")).toBeVisible();
  await expect.poll(async () => {
    const box = await calendar.boundingBox();
    return !!box && box.x >= -1 && box.x + box.width <= 321 && box.y >= -1 && box.y + box.height <= 801;
  }).toBe(true);
  const selected = calendar.getByRole("gridcell", { selected: true }).getByRole("button");
  await selected.focus();
  await expect.poll(() => selected.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await selected.press("Escape");
  await expect(input).toHaveValue("2024-03-01");
  await input.fill("0000-02-29");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(field.getByText("올바른 날짜를 YYYY-MM-DD 형식으로 입력하세요.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("0000-02-29");
  expect(writes).toEqual([]);
});
