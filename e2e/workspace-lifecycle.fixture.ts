import { expect, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";

const workspaceId = "00000000-0000-4000-8000-000000000981";
const actorId = "00000000-0000-4000-8000-000000000901";

test(
  "workspace deletion keeps its uncertain request through refresh and restoration uses the current generation",
  async ({ page }, info) => {
    const user = {
      id: actorId,
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript((user) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          user,
          access_token: "isolated-lifecycle-token",
          refresh_token: "isolated-lifecycle-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      );
    }, user);
    await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
    await installWorkspaceApi(page, "http://127.0.0.1:55623", { entities: [], tags: [], records: [], tasks: [] });
    let deletedAt: string | null = null, generation = 1;
    const writes: { method: string; key: string | undefined; body: unknown }[] = [];
    const workspace = () => ({
      id: workspaceId,
      name: "공동 업무 공간",
      deleted_at: deletedAt,
      lifecycle_generation: generation,
    });
    await page.route(/\/api\/workspaces(?:\/|$)/, async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
      if (method === "GET") {
        if (path === "/api/workspaces") {
          return route.fulfill({ json: { items: deletedAt ? [] : [{ ...workspace(), can_manage: true }] } });
        }
        if (path === "/api/workspaces/deleted") {
          return route.fulfill({ json: { items: deletedAt ? [workspace()] : [] } });
        }
        if (path.endsWith("/lifecycle")) return route.fulfill({ json: { workspace: workspace() } });
        return route.fallback();
      }
      writes.push({ method, key: request.headers()["idempotency-key"], body: request.postDataJSON() });
      if (method === "DELETE") {
        deletedAt = "2026-10-18T10:00:00Z";
        generation = 2;
        if (writes.length === 1) return route.abort("failed");
        return route.fulfill({ json: { workspace: workspace() } });
      }
      if (path.endsWith("/restore")) {
        deletedAt = null;
        generation = 3;
        return route.fulfill({ json: { workspace: workspace() } });
      }
      return route.fallback();
    });
    await page.goto("/workspaces");
    await page.getByRole("row").filter({ hasText: "공동 업무 공간" }).getByRole("button", { name: "삭제", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog");
    await confirmation.getByRole("button", { name: "공간 삭제", exact: true }).click();
    await expect(confirmation.getByText("저장 여부를 알 수 없습니다.", { exact: false })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(confirmation.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath("workspace-delete-recovery-mobile.png"), fullPage: true });
    await confirmation.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(writes[1]).toEqual(writes[0]);
    await page.getByRole("button", { name: "복원", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "공간 복원", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => writes.length).toBe(3);
    await expect(page.getByRole("button", { name: "복원", exact: true })).toHaveCount(0);
    expect(writes[2]).toEqual({
      method: "POST",
      key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      body: { expected_generation: 2 },
    });
    expect(writes[2].key).not.toBe(writes[0].key);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: info.outputPath("workspace-restored-desktop.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  },
);
