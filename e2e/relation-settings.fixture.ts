import { expect, test } from "@playwright/test";
import type { EntityRelationDefinition } from "../supabase/functions/_shared/contracts/entity-relation.ts";
const types = [{ id: "11111111-1111-4111-8111-111111111111", label: "주문", archived: false }, {
  id: "22222222-2222-4222-8222-222222222222",
  label: "주문품목",
  archived: false,
}];
test(
  "relation settings creates ordered roles, preserves conflict draft and archives inline",
  async ({ page, baseURL }, info) => {
    let rows: EntityRelationDefinition[] = [];
    let conflict = false;
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript((user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "fixture",
          refresh_token: "fixture",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      ), user);
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === new URL(baseURL!).origin) {
        return route.continue();
      }
      if (path.startsWith("/auth/")) return route.fulfill({ json: { ...user, user } });
      if (path === "/api/entity-types") {
        return route.fulfill({
          json: {
            items: types.map((t) => ({
              ...t,
              schema_version: 1,
              next_property_number: 2,
              icon_id: "box",
              created_at: "2026-10-17T00:00:00Z",
              updated_at: "2026-10-17T00:00:00Z",
            })),
            next_cursor: null,
          },
        });
      }
      if (path === "/api/entity-relation-definitions" && req.method() === "POST") {
        const input = req.postDataJSON();
        const row = { ...input, id: "33333333-3333-4333-8333-333333333333", version: 1, archived: false };
        rows.push(row);
        return route.fulfill({ status: 201, json: row });
      }
      if (path.startsWith("/api/entity-relation-definitions/") && req.method() === "PATCH") {
        if (conflict) {
          conflict = false;
          return route.fulfill({
            status: 409,
            json: { code: "settings_changed", message: "관계 설정이 변경되었습니다" },
          });
        }
        const input = req.postDataJSON();
        rows[0] = { ...rows[0], ...input, version: rows[0].version + 1 };
        return route.fulfill({ json: rows[0] });
      }
      if (path.startsWith("/api/entity-relation-definitions/")) return route.fulfill({ json: rows[0] });
      if (path === "/api/entity-relation-definitions") {
        return route.fulfill({
          json: {
            items: rows.filter((x) =>
              url.searchParams.get("archived") === "all" ||
              x.archived === (url.searchParams.get("archived") === "archived")
            ),
            next_cursor: null,
          },
        });
      }
      return route.fulfill({ json: { items: [], next_cursor: null } });
    });
    await page.goto("/settings/relations");
    await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "연결 설정 추가", exact: true }).click();
    await page.getByLabel(/첫 번째 자료 종류/).selectOption(types[0].id);
    await page.getByLabel(/첫 번째 연결 이름/).fill("주문품목");
    await page.getByLabel(/두 번째 자료 종류/).selectOption(types[1].id);
    await page.getByLabel(/두 번째 연결 이름/).fill("소속 주문");
    await page.getByLabel("두 번째 연결 개수", { exact: true }).selectOption("one");
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("저장했습니다");
    await page.getByRole("button", { name: /주문품목.*소속 주문/ }).click();
    conflict = true;
    await page.getByLabel(/첫 번째 연결 이름/).fill("품목");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("변경되었습니다");
    await expect(page.getByLabel(/첫 번째 연결 이름/)).toHaveValue("품목");
    await page.getByRole("button", { name: "최신 버전 확인", exact: true }).click();
    await page.getByRole("button", { name: "내 입력으로 다시 검토", exact: true }).click();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("저장했습니다");
    await page.getByRole("button", { name: /품목.*소속 주문/ }).click();
    for (const width of [320, 640, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`relation-pairs-${width}.png`), fullPage: true });
    }
    await page.getByRole("region", { name: "연결 설정", exact: true }).evaluate((panel) => {
      (panel as HTMLElement).style.maxWidth = "360px";
    });
    await page.screenshot({ path: info.outputPath("relation-pairs-narrow-parent.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("relation-pairs-200.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.style.fontSize = "");
    await page.getByLabel("보관").check();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByLabel("연결 설정 상태", { exact: true }).selectOption("all");
    await expect(page.getByRole("button", { name: /품목.*소속 주문/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  },
);
