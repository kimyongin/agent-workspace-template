import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import { encodeIdentifierReference, encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { setEntityCategory } from "./ui-actions.ts";
// Actual App and pagination bindings, with per-page Auth/API fixtures; no shared account.
import { expect, type Page, test } from "@playwright/test";
import { entity, fixtureType, id } from "./support/workspace-data.ts";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { openTabFilters } from "./ui-actions.ts";

async function fixture(page: Page) {
  const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_timezone: "Asia/Seoul" } };
  await installWorkspaceApi(page, "http://127.0.0.1:55587", { entities: [], tasks: [], records: [],  tags: [] });
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:55587" && url.pathname.startsWith("/api/")) return route.fallback();
    if (url.origin === "http://127.0.0.1:55587" && url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.origin === "http://127.0.0.1:55586") return route.continue();
    return route.abort();
  });
}

// Common engine tests own exhaustive cap/cancellation/error rules. Keep one true
// browser cap; each caller/device still checks URL, retry, rows and focus at small scale.
for (const [kind, path, label, restored] of [
  ["task", "tasks", "할 일", 20],
  ["record", "records", "기록", 20],
  ["record", "records", "기록", 250],
] as const) {
  test(`${label} ${restored === 250 ? "250-page cap" : "restored pages"}: retry preserves rows, focus and reading position`, async ({ page }) => {
    test.setTimeout(150_000);
    await fixture(page);
    const reads: number[] = [];
    const expectRestoredPages = async () => {
      const deadline = Date.now() + 60_000;
      const remaining = () => Math.max(1, deadline - Date.now());
      for (let target = Math.min(25, restored); target <= restored; target += Math.min(25, restored)) {
        await expect.poll(() => page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]").count(), {
          message: `${label}: restore must reach ${target}/${restored} rows without stalling`,
          timeout: Math.min(10_000, remaining()),
          intervals: [100, 250, 500],
        }).toBeGreaterThanOrEqual(target);
        expect(reads.slice(0, target)).toEqual(Array.from({ length: target }, (_, index) => index));
      }
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(restored, { timeout: remaining() });
      expect(reads).toEqual(Array.from({ length: restored }, (_, index) => index));
    };
    let failNext = true;
    await page.route(`**/api/${path}?**`, async (route) => {
      const index = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
      reads.push(index);
      if (index === restored && failNext) {
        failNext = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "internal", message: "temporary boundary failure" }),
        });
        return;
      }
      await route.fulfill({
        json: {
          items: [{
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            ...(kind === "task" ? {title: `${label} 경계 ${index}`} : {}),
            body: `${label} 경계 ${index}`,
            tag_ids: [],
            entity_ids: [],
            entity_context: [],
            kind: "once",
            status: "open",
            occurred_at: "2026-10-04T00:00:00Z",
          }],
          next_cursor: String(index + 1),
        },
      });
    });
    await page.goto(fixtureWorkspacePath(`/${path}?pages=${restored}`));
    await expectRestoredPages();
    const first = page.getByRole("button", { name: `${label} 경계 0`, exact: true });
    await page.locator(`#activity-${path}-page-control`).click();
    await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(restored);
    const retry = page.getByRole("button", { name: "다시 시도", exact: true });
    await retry.scrollIntoViewIfNeeded();
    const readingRow = page.locator(`#${await page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]").last().getAttribute("id")}`);
    await expect(readingRow).toBeInViewport();
    const readingY = (await readingRow.boundingBox())!.y;
    const readingScroll = await page.getByRole("main").evaluate(el => el.scrollTop);
    await retry.click();
    await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(restored + 1);
    await expect(first).toHaveCount(1);
    await expect(page.locator(`#activity-${path}-page-control`)).toBeFocused();
    expect(await page.getByRole("main").evaluate(el => el.scrollTop)).toBe(readingScroll);
    await expect(readingRow).toBeInViewport();
    expect((await readingRow.boundingBox())!.y).toBeCloseTo(readingY, 1);
    expect(new URL(page.url()).searchParams.get("pages")).toBe(String(restored + 1));
    expect(reads).toEqual([...Array.from({ length: restored }, (_, index) => index), restored, restored]);
    await page.locator(`#activity-${path}-page-control`).click();
    await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(restored + 2);
    expect(reads.at(-1)).toBe(restored + 1);
    reads.length = 0;
    await page.reload();
    if (restored === 250) await expectRestoredPages();
    else {
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(restored + 2);
      expect(reads).toEqual(Array.from({ length: restored + 2 }, (_, index) => index));
    }
  });
}

test("Entity restored pages: retry cursor, focus and filter reset", async ({ page }) => {
  await fixture(page);
  const cursors: (string | null)[] = [];
  let failed = false;
  await page.route("**/api/entities?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor === "page-2" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { code: "unavailable", message: "3페이지 일시 실패", retryable: true, fields: [] },
      });
      return;
    }
    const index = cursor ? Number(cursor.slice(5)) + 1 : 1;
    const externalId = crypto.randomUUID();
    await route.fulfill({
      json: {
        items: [{
          ...entity(index,{prop_1:`경계 항목 ${index}`}),
          id: encodeIdentifierReference(fixtureType.id, APP_IDENTIFIER_RULE_ID, externalId),
          identity_label: `앱 · 자동 발급 · ${externalId}`,
          properties: { ...entity(index).properties, prop_1: `경계 항목 ${index}`, prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, externalId) },
        }],
        next_cursor: `page-${index}`,
      },
    });
  });
  await page.goto(fixtureWorkspacePath("/entities?entity_type_id=00000000-0000-4000-8000-000000000900&pages=2"));
  const more = page.getByRole("button", { name: "더 보기", exact: true });
  await expect(more).toHaveAttribute("aria-disabled", "false", { timeout: 30000 });
  await expect(page.locator("[data-list-anchor]")).toHaveCount(2);
  expect(cursors).toHaveLength(2);
  await more.click();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeFocused();
  await expect(retry).toBeInViewport();
  await expect(page.locator("[data-list-anchor]")).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get("pages")).toBe("3");
  expect(cursors.at(-1)).toBe("page-2");
  await retry.click();
  await expect(page.locator("[data-list-anchor]")).toHaveCount(3);
  await expect(more).toBeFocused();
  expect(cursors).toHaveLength(4);
  expect(cursors.slice(-2)).toEqual(["page-2", "page-2"]);
  const beforeFilter = cursors.length;
  await openTabFilters(page);
  await setEntityCategory(page, "b");
  await expect(page.locator("[data-list-anchor]")).toHaveCount(1);
  await setEntityCategory(page, "");
  await expect.poll(() => cursors.length).toBe(beforeFilter + 2);
  await expect(page.locator("[data-list-anchor]")).toHaveCount(1);
  await expect(more).toHaveAttribute("aria-disabled", "false");
  expect(cursors.slice(beforeFilter)).toEqual([null, null]);
});

test("Entity pagination failure does not move focus or scroll after the user leaves the page control", async ({ page }) => {
  await fixture(page);
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/entities?**", async route => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      started();
      await waiting;
      return route.fulfill({ status: 503, json: { code: "unavailable", message: "지연된 페이지 실패", retryable: true, fields: [] } });
    }
    return route.fulfill({ json: { items: [entity(1), entity(2)], next_cursor: "next" } });
  });
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await pending;
  try {
    const search = page.getByRole("textbox", { name: "자료 제목 검색", exact: true });
    await search.focus();
    const main = page.getByRole("main");
    const top = await main.evaluate(element => element.scrollTop);
    release();
    await expect(page.getByRole("alert")).toContainText("지연된 페이지 실패");
    await expect(search).toBeFocused();
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(top);
    await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeEnabled();
  } finally { release(); }
});
