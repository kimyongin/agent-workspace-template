import { expect, type Page, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { task, type WorkspaceRows } from "./support/workspace-data.ts";
const a = "00000000-0000-4000-8000-000000000981",
  b = "00000000-0000-4000-8000-000000000982";
const actor = "00000000-0000-4000-8000-000000000901";
function rows(title: string): WorkspaceRows {
  return { entities: [], tags: [], records: [], tasks: [{ ...task(), title }] };
}
async function fixture(page: Page) {
  const user = {
    id: actor,
    aud: "authenticated",
    email: "workspace-fixture@example.test",
    app_metadata: {},
    user_metadata: {},
  };
  await page.addInitScript((user) => {
    localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        user,
        access_token: "isolated-workspace-token",
        refresh_token: "isolated-workspace-refresh",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  }, user);
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  return installWorkspaceApi(
    page,
    "http://127.0.0.1:55613",
    rows("space A task"),
    {
      workspaces: {
        [a]: { name: "공간 A", rows: rows("space A task") },
        [b]: { name: "공간 B", rows: rows("space B task") },
      },
    },
  );
}
async function choose(page: Page, name: string) {
  await page.getByRole("button", { name: "공간 선택", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
test("same-origin tabs keep independent route spaces and business headers", async ({ page, context }) => {
  const first = await fixture(page),
    other = await context.newPage(),
    second = await fixture(other);
  await page.goto(`/w/${a}/tasks`);
  await other.goto(`/w/${b}/tasks`);
  await expect(page.getByText("space A task", { exact: true }).first())
    .toBeVisible();
  await expect(other.getByText("space B task", { exact: true }).first())
    .toBeVisible();
  await choose(page, "공간 B");
  await expect(page).toHaveURL(new RegExp(`/w/${b}/tasks$`));
  await expect(other).toHaveURL(new RegExp(`/w/${b}/tasks$`));
  await choose(other, "공간 A");
  await expect(page).toHaveURL(new RegExp(`/w/${b}/tasks$`));
  await expect(other).toHaveURL(new RegExp(`/w/${a}/tasks$`));
  await expect(other.getByText("space A task", { exact: true }).first())
    .toBeVisible();
  expect(
    first.requests.filter((request) => request.path === "/api/tasks").map(
      (request) => request.workspaceId,
    ),
  ).toEqual([a, b]);
  expect(
    second.requests.filter((request) => request.path === "/api/tasks").map(
      (request) => request.workspaceId,
    ),
  ).toEqual([b, a]);
});
test(
  "canceling a dirty-space switch retains its draft; confirming retires it",
  async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fixture(page);
    await page.goto(`/w/${a}/tasks/${task().id}?edit=1`);
    const draft = page.getByRole("textbox", { name: /^제목/ });
    await draft.fill("origin draft");
    await page.screenshot({
      path: info.outputPath("workspace-draft-desktop.png"),
      fullPage: true,
    });
    await choose(page, "공간 B");
    const confirmation = page.getByRole("alertdialog");
    await confirmation.getByRole("button", { name: "취소", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/w/${a}/tasks/${task().id}\\?edit=1$`),
    );
    await expect(draft).toHaveValue("origin draft");
    await choose(page, "공간 B");
    await confirmation.getByRole("button", { name: "변경 버리기", exact: true })
      .click();
    await expect(page.getByText("space B task", { exact: true }).first())
      .toBeVisible();
    await expect(draft).toHaveCount(0);
  },
);
test("a held old-space list cannot replace the newly selected space", async ({ page }) => {
  const api = await fixture(page),
    held = api.holdRead({ kind: "tasks", workspaceId: a });
  await page.goto(`/w/${a}/tasks`);
  await held.started;
  await choose(page, "공간 B");
  await expect(page.getByText("space B task", { exact: true }).first())
    .toBeVisible();
  held.release();
  await held.finished;
  await expect(page.getByText("space A task", { exact: true })).toHaveCount(0);
});
test("workspace creation is explicit and its confirmed response selects the returned space", async ({ page }) => {
  const api = await fixture(page);
  delete api.workspaces[a];
  delete api.workspaces[b];
  const creations: {
    key: string | undefined;
    body: unknown;
    scope: string | undefined;
  }[] = [];
  await page.route("**/api/workspaces", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creations.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
      scope: route.request().headers()["x-workspace-id"],
    });
    api.workspaces[a] = { name: "새 공간", rows: rows("new workspace task") };
    return route.fulfill({
      status: 201,
      json: { workspace: { id: a, name: "새 공간", deleted_at: null } },
    });
  });
  await page.goto("/workspaces");
  await expect(page.getByText("참여 중인 공간이 없습니다", { exact: true }))
    .toBeVisible();
  expect(creations).toHaveLength(0);
  await page.getByRole("button", { name: "새 공간 만들기", exact: true })
    .click();
  await page.getByRole("textbox", { name: "공간 이름", exact: true }).fill(
    "새 공간",
  );
  await page.getByRole("button", { name: "공간 만들기", exact: true }).click();
  await expect(page.getByText("new workspace task", { exact: true }).first())
    .toBeVisible();
  expect(creations).toEqual([{
    key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    body: { name: "새 공간" },
    scope: undefined,
  }]);
});
test("invitation acceptance sends no editable email identity and opens its server-confirmed space", async ({ page }) => {
  await fixture(page);
  const accepted: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/invitations/*/accept", (route) => {
    accepted.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      json: { workspace: { id: a, name: "공간 A", deleted_at: null } },
    });
  });
  await page.goto(
    "/invitations/00000000-0000-4000-8000-000000000990?from=email#accept",
  );
  await page.getByRole("button", { name: "초대 수락", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${a}/tasks$`));
  expect(accepted).toEqual([{
    key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    body: {},
  }]);
});
test(
  "workspace management previews exact grants and labels pending email honestly at narrow width",
  async ({ page }, info) => {
    await fixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    let input: Record<string, unknown> | undefined;
    let invitation: Record<string, unknown> | null = null;
    await page.route(
      "**/api/workspaces/*/members",
      (route) =>
        route.fulfill({
          json: {
            items: [{
              user_id: actor,
              version: 1,
              grants: [{
                target_kind: "settings",
                target_id: "*",
                access: "write",
              }],
            }],
          },
        }),
    );
    await page.route("**/api/workspaces/*/invitations", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      input = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          invitation: { id: "invite", version: 1 },
          acceptance_path: "/invitations/00000000-0000-4000-8000-000000000990",
          delivery: { status: "pending" },
        },
      });
    });
    await page.goto(`/w/${a}/manage`);
    await page.getByRole("button", { name: "이메일로 초대", exact: true })
      .click();
    await page.getByRole("textbox", { name: "초대할 이메일", exact: true })
      .fill("guest@example.test");
    await page.getByRole("radiogroup", { name: "할 일", exact: true })
      .getByRole(
        "radio",
        { name: "읽기·쓰기", exact: true },
      ).click();
    await expect(
      page.getByRole("radiogroup", { name: "할 일", exact: true }).getByRole(
        "radio",
        { name: "읽기·쓰기", exact: true },
      ),
    ).toHaveAttribute("data-state", "on");
    await page.screenshot({
      path: info.outputPath("workspace-invitation-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "초대 만들기", exact: true })
      .click();
    await expect(
      page.getByText("초대를 만들었습니다. 이메일 전달을 기다리는 중입니다.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(input).toEqual({
      email: "guest@example.test",
      grants: [{ target_kind: "settings", target_id: "*", access: "none" }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }],
    });
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("workspace-management-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: info.outputPath("workspace-management-desktop.png"), fullPage: true });
  },
);
