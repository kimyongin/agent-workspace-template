import { expect, test } from "@playwright/test";
import type { EntitySchemaMigration } from "../supabase/functions/_shared/contracts/entity-schema-migration.ts";
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
const head = () => [job(30, "preparing"), ...Array.from({ length: 19 }, (_, n) => job(29 - n))];
test("자동 상태 갱신 후 펼친 20개 초과 이력과 다음 페이지를 유지한다", async ({ page }) => {
  await page.route("**/api/entity-schema-migrations?**", async (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    await route.fulfill({
      json: before === id(11)
        ? { items: [job(10), job(9)], next_before: id(9) }
        : before === id(9)
        ? { items: [job(8)], next_before: null }
        : { items: head(), next_before: id(11) },
    });
  });
  await page.clock.install();
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link")).toHaveCount(22);
  await page.clock.fastForward(1500);
  await expect(page.getByRole("link", { name: "작업 9 · 완료 · 10/10", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link", { name: "작업 8 · 완료 · 10/10", exact: true })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(23);
});
test("늦은 첫 페이지 응답과 더 보기가 겹쳐도 중복과 오래된 상태를 적용하지 않는다", async ({ page }) => {
  let first = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.method());
  });
  await page.route("**/api/entity-schema-migrations?**", async (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    if (before) return route.fulfill({ json: { items: [job(11, "preparing", 3), job(10)], next_before: id(10) } });
    if (!first) await held;
    first = false;
    await route.fulfill({ json: { items: head(), next_before: id(11) } });
  });
  await page.clock.install();
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  const polling = page.waitForRequest((request) => request.url().endsWith(`type_id=${typeId}`));
  await page.clock.fastForward(1500);
  await polling;
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link")).toHaveCount(21);
  const completed = page.waitForResponse((response) => response.url().endsWith(`type_id=${typeId}`));
  release();
  await completed;
  await expect(page.getByRole("link", { name: "작업 11 · 준비 중 · 3/10", exact: true })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(21);
  expect(writes).toEqual([]);
});
test("더 보기 실패와 첫 페이지 재조회에도 이력을 유지하며 같은 다음 페이지를 재시도한다", async ({ page }) => {
  let failed = false;
  await page.route("**/api/entity-schema-migrations?**", async (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    if (before === id(10) && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { code: "unavailable", message: "과거 작업 읽기 실패" } });
    }
    await route.fulfill({
      json: before === id(11)
        ? { items: [job(10)], next_before: id(10) }
        : before === id(10)
        ? { items: [job(9)], next_before: null }
        : { items: head().map((value) => ({ ...value, status: "succeeded" })), next_before: id(11) },
    });
  });
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link")).toHaveCount(21);
  await page.getByRole("button", { name: "작업 목록 다시 조회" }).click();
  await expect(page.getByRole("link", { name: "작업 10 · 완료 · 10/10", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("alert")).toHaveText("과거 작업 읽기 실패");
  await expect(page.getByRole("link")).toHaveCount(21);
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link", { name: "작업 9 · 완료 · 10/10", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이전 작업 더 보기" })).toHaveCount(0);
});
test("자료 종류를 바꾸면 이전 종류의 늦은 더 보기 결과를 버린다", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/entity-schema-migrations?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("type_id") === id(2)) {
      return route.fulfill({
        json: {
          items: [{
            ...job(50),
            type_id: id(2),
            type: { id: id(2), label: "상품 작업", icon_id: "leaf", archived: false },
          }],
          next_before: null,
        },
      });
    }
    if (params.has("before")) {
      await held;
      await route.fulfill({ json: { items: [job(10)], next_before: id(10) } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: { items: head(), next_before: id(11) } });
  });
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  const pending = page.waitForRequest((request) => request.url().includes("&before="));
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await pending;
  await page.getByRole("button", { name: "상품 작업으로 이동" }).click();
  await expect(page.getByRole("link", { name: "상품 작업 · 완료 · 10/10", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /작업 10/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이전 작업 더 보기" })).toHaveCount(0);
});
test("자동 첫 페이지 갱신은 실패한 더 보기의 안내와 재시도 위치를 지우지 않는다", async ({ page }) => {
  let first = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/entity-schema-migrations?**", async (route) => {
    if (new URL(route.request().url()).searchParams.has("before")) {
      return route.fulfill({ status: 503, json: { code: "unavailable", message: "과거 작업 읽기 실패" } });
    }
    if (!first) await held;
    first = false;
    await route.fulfill({ json: { items: head(), next_before: id(11) } });
  });
  await page.clock.install();
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  const polling = page.waitForRequest((request) => request.url().endsWith(`type_id=${typeId}`));
  await page.clock.fastForward(1500);
  await polling;
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("alert")).toHaveText("과거 작업 읽기 실패");
  const completed = page.waitForResponse((response) => response.url().endsWith(`type_id=${typeId}`));
  release();
  await completed;
  await expect(page.getByRole("alert")).toHaveText("과거 작업 읽기 실패");
  await expect(page.getByRole("button", { name: "이전 작업 더 보기" })).toBeEnabled();
});
test("새 작업 20개 뒤의 재시도 작업도 펼친 위치에서 확정 상태까지 자동 조회한다", async ({ page }) => {
  await page.route("**/api/entity-schema-migrations**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${id(10)}`)) return route.fulfill({ json: job(10, "succeeded", 3) });
    await route.fulfill({
      json: url.searchParams.has("before")
        ? { items: [job(10, "preparing", 2), job(9)], next_before: id(9) }
        : { items: head().map((value) => ({ ...value, status: "succeeded" })), next_before: id(11) },
    });
  });
  await page.clock.install();
  await page.goto("/e2e/fixtures/schema-job-history.html");
  await expect(page.getByRole("link")).toHaveCount(20);
  await page.getByRole("button", { name: "이전 작업 더 보기" }).click();
  await expect(page.getByRole("link")).toHaveCount(22);
  await page.clock.fastForward(1500);
  await expect(page.getByRole("link", { name: "작업 10 · 완료 · 10/10", exact: true })).toBeVisible();
  await expect(page.getByRole("link").nth(20)).toHaveAccessibleName("작업 10 · 완료 · 10/10");
  await expect(page.getByRole("button", { name: "이전 작업 더 보기" })).toBeEnabled();
});

test("취소 성공 응답은 후속 조회가 늦어도 즉시 표시하고 이전 접수 상태로 돌아가지 않는다", async ({ page }) => {
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/entity-schema-migrations/${id(30)}`, async (route) => {
    reads++;
    if (reads > 1) await held;
    await route.fulfill({ json: job(30, "queued", 1) });
  });
  await page.route(`**/api/entity-schema-migrations/${id(30)}/cancel`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expected_job_version: 1 });
    await route.fulfill({ json: job(30, "cancelled", 2) });
  });
  await page.clock.install();
  await page.goto("/e2e/fixtures/schema-job-history.html?job=30");
  await expect(page.getByRole("status")).toContainText("접수");
  try {
    await page.getByRole("button", { name: "변환 취소", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("취소");
    await expect(page.getByRole("button", { name: "변환 취소", exact: true })).toHaveCount(0);
    const refreshed = page.waitForResponse((response) =>
      response.url().endsWith(`/entity-schema-migrations/${id(30)}`)
    );
    release();
    await (await refreshed).finished();
    await page.clock.runFor(100);
    await expect(page.getByRole("status")).toContainText("취소");
  } finally {
    release();
  }
});

test("재시도의 접수 응답은 작업 상세로 취급하지 않고 조회된 작업 이름과 상태를 유지한다", async ({ page }) => {
  let retried = false;
  await page.route(`**/api/entity-schema-migrations/${id(30)}`, async (route) => {
    await route.fulfill({
      json: retried ? job(30, "queued", 4) : { ...job(30, "failed", 3), retryable: true, failure_reason: "일시 오류" },
    });
  });
  await page.route(`**/api/entity-schema-migrations/${id(30)}/retry`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expected_job_version: 3 });
    retried = true;
    await route.fulfill({
      status: 202,
      json: {
        job_id: id(30),
        type_id: typeId,
        change_id: id(500),
        analysis_id: id(501),
        job_version: 4,
        status: "queued",
      },
    });
  });
  await page.goto("/e2e/fixtures/schema-job-history.html?job=30");
  await expect(page.getByRole("status")).toContainText("실패");
  await page.getByRole("button", { name: "같은 작업 재시도", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("접수");
  await expect(page.getByText(/작업 30의 수정·삭제·설정 게시/)).toBeVisible();
  await expect(page.getByRole("button", { name: "변환 취소", exact: true })).toBeVisible();
});
