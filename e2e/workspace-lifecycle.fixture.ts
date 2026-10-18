import { expect, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";

const workspaceId = "00000000-0000-4000-8000-000000000981";
const actorId = "00000000-0000-4000-8000-000000000901";

test(
  "long workspace names and lifecycle controls remain usable at narrow widths and enlarged display scale",
  async ({ page }, info) => {
    const user = {
      id: actorId,
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: { workspace_display_scale: 150, workspace_mobile_display_scale: 150 },
    };
    await page.addInitScript((user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          user,
          access_token: "isolated-lifecycle-token",
          refresh_token: "isolated-lifecycle-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      ), user);
    await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
    await installWorkspaceApi(page, "http://127.0.0.1:55623", { entities: [], tags: [], records: [], tasks: [] });
    const workspace = {
      id: workspaceId,
      name: "긴공동업무공간이름".repeat(11).slice(0, 100),
      deleted_at: null,
      lifecycle_generation: 1,
    };
    let writes = 0;
    await page.route(/\/api\/workspaces(?:\/|$)/, (route) => {
      if (route.request().method() !== "GET") {
        writes++;
        return route.abort("failed");
      }
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/workspaces") {
        return route.fulfill({ json: { items: [{ ...workspace, can_manage: true }] } });
      }
      if (path === "/api/workspaces/deleted") return route.fulfill({ json: { items: [] } });
      if (path.endsWith("/lifecycle")) return route.fulfill({ json: { workspace } });
      return route.fallback();
    });
    await page.goto("/workspaces");
    await expect(page.getByRole("table", { name: "공간 목록", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `width ${width} scale150`)
        .toBe(true);
      if (width === 320 || width === 1440) {
        await page.screenshot({
          path: info.outputPath(`workspace-list-${width}-scale150.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 320, height: 560 });
    await page.evaluate(() => document.documentElement.style.zoom = "2");
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const dialog = page.getByRole("alertdialog"),
      confirm = dialog.getByRole("button", { name: "공간 삭제", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.scrollIntoViewIfNeeded();
    const bounds = (await confirm.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(88);
    expect(bounds.height).toBeGreaterThanOrEqual(88);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(560);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("workspace-delete-320-short-zoom200.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(writes).toBe(0);
  },
);

for (
  const scenario of [
    {
      name: "creator management",
      can_manage: true,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      path: "/manage",
    },
    {
      name: "task reader",
      can_manage: false,
      grants: [{ target_kind: "tasks", target_id: "*", access: "read" }],
      path: "/tasks",
    },
    {
      name: "settings reader",
      can_manage: false,
      grants: [{ target_kind: "settings", target_id: "*", access: "read" }],
      path: "/settings/data-model",
    },
    {
      name: "permitted material",
      can_manage: false,
      grants: [{ target_kind: "entity_type", target_id: "00000000-0000-4000-8000-000000000999", access: "read" }],
      path: "/entities?entity_type_id=00000000-0000-4000-8000-000000000999",
    },
    { name: "no business access", can_manage: false, grants: [], path: "" },
  ]
) {
  test(`workspace landing respects current capabilities for ${scenario.name}`, async ({ page }) => {
    const user = {
      id: actorId,
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: {},
    };
    await page.addInitScript((user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          user,
          access_token: "isolated-lifecycle-token",
          refresh_token: "isolated-lifecycle-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      ), user);
    await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
    const rows = { entities: [], tags: [], records: [], tasks: [] };
    const api = await installWorkspaceApi(page, "http://127.0.0.1:55623", rows, {
      workspaces: { [workspaceId]: { name: "권한별 시작 공간", rows } },
    });
    await page.route(`**/api/workspaces/${workspaceId}`, (route) =>
      route.fulfill({
        json: {
          workspace: { id: workspaceId, name: "권한별 시작 공간", deleted_at: null },
          membership_version: 1,
          grants: scenario.grants,
          can_manage: scenario.can_manage,
        },
      }));
    await page.goto(`/w/${workspaceId}`);
    await expect(page).toHaveURL(`http://127.0.0.1:55622/w/${workspaceId}${scenario.path}`);
    if (!scenario.path) {
      await expect(page.getByRole("heading", { name: "열 수 있는 업무가 없습니다", exact: true })).toBeVisible();
    }
    if (scenario.name !== "task reader") {
      expect(api.requests.filter((request) => request.path === "/api/tasks")).toHaveLength(0);
    }
  });
}

for (const loseResponse of [false, true]) {
  test(
    loseResponse
      ? "an uncertain exit checks current membership without blindly resending"
      : "a manager can leave a deleted space using its current own membership version",
    async ({ page }) => {
      const user = {
        id: actorId,
        aud: "authenticated",
        email: "fixture@example.test",
        app_metadata: {},
        user_metadata: {},
      };
      await page.addInitScript(
        (user) =>
          localStorage.setItem(
            "sb-127-auth-token",
            JSON.stringify({
              user,
              access_token: "isolated-lifecycle-token",
              refresh_token: "isolated-lifecycle-refresh",
              token_type: "bearer",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            }),
          ),
        user,
      );
      await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
      await installWorkspaceApi(page, "http://127.0.0.1:55623", { entities: [], tags: [], records: [], tasks: [] });
      const workspace = {
        id: workspaceId,
        name: "삭제한 공동 공간",
        deleted_at: "2026-10-18T10:00:00Z",
        lifecycle_generation: 2,
      };
      let left = false;
      const writes: unknown[] = [];
      await page.route(/\/api\/workspaces(?:\/|$)/, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/leave")) {
          writes.push(route.request().postDataJSON());
          left = true;
          return loseResponse ? route.abort("failed") : route.fulfill({ json: { left: true } });
        }
        if (path === "/api/workspaces") return route.fulfill({ json: { items: [] } });
        if (path === "/api/workspaces/deleted") return route.fulfill({ json: { items: left ? [] : [workspace] } });
        if (path.endsWith("/membership")) {
          return route.fulfill(
            left
              ? { status: 403, json: { code: "forbidden", message: "현재 참여를 확인할 수 없습니다." } }
              : { json: { workspace, membership_version: 4 } },
          );
        }
        return route.fallback();
      });
      await page.goto("/workspaces");
      await page.getByRole("row").filter({ hasText: "삭제한 공동 공간" }).getByRole("button", {
        name: "탈퇴",
        exact: true,
      })
        .click();
      await page.getByRole("alertdialog").getByRole("button", { name: "공간 탈퇴", exact: true }).click();
      if (loseResponse) {
        const dialog = page.getByRole("alertdialog");
        await expect(dialog.getByText("저장 여부를 알 수 없습니다.", { exact: false })).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(dialog.getByText("현재 참여를 확인할 수 없습니다.", { exact: true })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeDisabled();
        await expect(dialog.getByText("이전 요청의 결과는 확인되지 않았습니다.", { exact: false })).toBeVisible();
        expect(writes).toHaveLength(1);
        await dialog.getByRole("button", { name: "취소", exact: true }).click();
      }
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByRole("table", { name: "삭제한 공간", exact: true })).toHaveCount(0);
      expect(writes).toEqual([{ expected_version: 4 }]);
    },
  );
}

test("a known management revocation on focus disables a previously prepared lifecycle action", async ({ page }) => {
  const user = {
    id: actorId,
    aud: "authenticated",
    email: "fixture@example.test",
    app_metadata: {},
    user_metadata: {},
  };
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          user,
          access_token: "isolated-lifecycle-token",
          refresh_token: "isolated-lifecycle-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    user,
  );
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  await installWorkspaceApi(page, "http://127.0.0.1:55623", { entities: [], tags: [], records: [], tasks: [] });
  let revoked = false, writes = 0;
  const workspace = { id: workspaceId, name: "권한 변경 공간", deleted_at: null, lifecycle_generation: 1 };
  await page.route(/\/api\/workspaces(?:\/|$)/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      writes++;
      return route.fulfill({ status: 403, json: { code: "forbidden", message: "공간 관리 권한이 없습니다." } });
    }
    if (path === "/api/workspaces") return route.fulfill({ json: { items: [{ ...workspace, can_manage: !revoked }] } });
    if (path === "/api/workspaces/deleted") return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/lifecycle")) {
      return route.fulfill(
        revoked
          ? { status: 403, json: { code: "forbidden", message: "공간 관리 권한이 없습니다." } }
          : { json: { workspace } },
      );
    }
    return route.fallback();
  });
  await page.goto("/workspaces");
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  const confirmation = page.getByRole("alertdialog"),
    action = confirmation.getByRole("button", { name: "공간 삭제", exact: true });
  await expect(action).toBeEnabled();
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(confirmation.getByText("공간 관리 권한이 없습니다.", { exact: true })).toBeVisible();
  await expect(action).toBeDisabled();
  expect(writes).toBe(0);
});

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
