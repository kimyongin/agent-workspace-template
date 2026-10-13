import { expect, test } from "@playwright/test";
import { entityDetail } from "../supabase/functions/_shared/contracts/entity.ts";
import { defaultEntityIdentitySettings } from "../supabase/functions/_shared/contracts/entity-identity.ts";
import { type EntityType, initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
import type { EntitySchemaMigration } from "../supabase/functions/_shared/contracts/entity-schema-migration.ts";
const type = (n: number, label: string, archived = false): EntityType => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  label,
  archived,
  icon_id: "leaf",
  version: 1,
  schema_version: 1,
  next_property_number: 2,
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
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname === "/api/entity-types") {
      return route.fulfill({ json: { items: [materials, products, retired], next_cursor: null } });
    }
    const selected = [materials, products, retired].find((value) =>
      url.pathname.startsWith(`/api/entity-types/${value.id}`)
    );
    if (selected) {
      if (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes")) {
        return route.fulfill({ json: { items: [], next_before: null } });
      }
      return route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? { type: selected, type_id: selected.id, schema_version: 1, ...initialEntityDefinition("이름") }
          : selected,
      });
    }
    if (await fulfillPreparation(route)) return;
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

const typeId = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n: number, status: EntitySchemaMigration["status"] = "succeeded", version = 1): EntitySchemaMigration => ({
  id: id(n),
  type_id: typeId,
  type: { id: typeId, label: `작업 ${n}`, icon_id: "leaf", archived: false },
  change_id: id(500),
  change_version: 1,
  analysis_id: id(501),
  fingerprint: "a".repeat(64),
  source_type_version: 1,
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
    (route) => route.fulfill({ json: job(Number(new URL(route.request().url()).pathname.split("-").at(-1))) }),
  );
  await page.goto(`/settings/entity-types/${materials.id}/migrations/${id(20)}`);
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("남길 기본 입력");
  await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
  await page.getByLabel("속성 이름", { exact: true }).fill("남길 속성 입력");
  await page.getByRole("link", { name: "작업 21 · 완료 · 10/10", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("남길 기본 입력");
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("남길 속성 입력");
  await expect(page.getByRole("button", { name: /^선택한 값 변환 작업/ })).toContainText("완료");
  await page.goBack();
  await expect(page.getByLabel("속성 이름", { exact: true })).toHaveValue("남길 속성 입력");
});

test("실패 작업의 응답 불명 재시도는 같은 내용과 키로 확인하며 기본 입력을 보존한다", async ({ page }) => {
  let version = 1;
  const requests: Array<{ body: unknown; key: string | undefined }> = [];
  await page.route("**/api/entity-schema-migrations/**", (route) => {
    if (route.request().method() === "POST") {
      requests.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
      if (requests.length === 1) {
        version = 2;
        return route.abort("failed");
      }
      return route.fulfill({ json: { job_id: id(20), status: "queued" } });
    }
    return route.fulfill({
      json: { ...job(20, "failed", version), retryable: true, failure_reason: "임시 처리 실패" },
    });
  });
  await page.goto(`/settings/entity-types/${materials.id}/migrations/${id(20)}`);
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("기본 초안");
  await page.getByRole("button", { name: "같은 작업 재시도", exact: true }).click();
  await page.getByRole("button", { name: "상태 다시 조회", exact: true }).click();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("기본 초안");
});

test("완료 작업에서 만든 원본 복구안은 같은 작업공간과 기본 초안을 유지한다", async ({ page }) => {
  const source = {
    ...job(20),
    source_expires_at: "2026-11-13T00:00:00Z",
    recovery: { status: "available", reason: null, current_type_version: 1, current_schema_version: 1, conflicts: [] },
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
    source_type_version: 1,
    source_schema_version: 1,
    source_template_fingerprint: "fixture",
    edits: [],
    executable: false,
    fingerprint: "fixture",
    created_at: materials.created_at,
    updated_at: materials.updated_at,
    recovery: { source_job_id: source.id, source_expires_at: source.source_expires_at },
  };
  await page.route(
    "**/api/entity-schema-migrations/**",
    (route) => route.fulfill({ json: route.request().method() === "POST" ? recovered : source }),
  );
  await page.route(
    `**/api/entity-types/${materials.id}/schema-changes/${recovered.id}`,
    (route) => route.fulfill({ json: recovered }),
  );
  await page.goto(`/settings/entity-types/${materials.id}/migrations/${source.id}`);
  await page.getByRole("button", { name: /^기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("復帰する基本入力");
  await page.getByRole("button", { name: "원본 복구안 만들기", exact: true }).click();
  await expect(page.getByRole("region", { name: "복구안 원본", exact: true })).toBeVisible();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("復帰する基本入力");
  await page.getByRole("link", { name: "원본 작업 확인", exact: true }).click();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("復帰する基本入力");
  await expect(page.getByRole("region", { name: "복구안 원본", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^선택한 값 변환 작업/ })).toContainText("완료");
});
