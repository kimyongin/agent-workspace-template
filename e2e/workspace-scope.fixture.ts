import { expect, type Page, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { fixtureType, task, type WorkspaceRows } from "./support/workspace-data.ts";
import { openMainNavigation } from "./ui-actions.ts";
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
  const api = await installWorkspaceApi(
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
  await page.route(/\/api\/workspaces\/[0-9a-f-]{36}$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!, space = api.workspaces[id];
    if (route.request().method() !== "GET" || !space) return route.fallback();
    return route.fulfill({
      json: {
        workspace: { id, name: space.name, deleted_at: null },
        membership_version: 1,
        can_manage: true,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }, {
          target_kind: "tasks",
          target_id: "*",
          access: "write",
        }],
      },
    });
  });
  return api;
}
async function choose(page: Page, name: string) {
  await openMainNavigation(page);
  await page.getByRole("button", { name: "공간 선택", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
test("workspace landing can return from management to settings through the profile menu", async ({ page }) => {
  await fixture(page);
  await page.route(`**/api/workspaces/${a}`, (route) =>
    route.fulfill({
      json: {
        workspace: { id: a, name: "공간 A", deleted_at: null },
        membership_version: 1,
        can_manage: true,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      },
    }));
  await page.goto(`/w/${a}`);
  await expect(page.getByRole("heading", { name: "공간 관리", exact: true })).toBeVisible();
  await openMainNavigation(page);

  await page.getByRole("link", { name: "기본 설정", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${a}/settings$`));
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible({ timeout: 5000 });
  const section = page.getByRole("region", { name: "워크스페이스", exact: true });
  await expect(section.getByRole("link", { name: "이 공간 관리", exact: true })).toHaveAttribute(
    "href",
    `/w/${a}/manage`,
  );
});

test("workspace selection has one entry and settings owns management for the selected space", async ({ page }, info) => {
  await fixture(page);
  await page.goto(`/w/${a}/settings`);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
  if (info.project.name === "mobile") await expect(page.getByRole("banner").getByText("공간 A", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("workspace-settings-entry.png"), fullPage: true, animations: "disabled" });
  await openMainNavigation(page);
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  const switcher = navigation.getByRole("button", { name: "공간 선택", exact: true });
  await expect(switcher).toHaveCount(1);
  await expect(switcher).toContainText("공간 A");
  await switcher.click();
  await page.screenshot({ path: info.outputPath("workspace-selection-menu.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByRole("menuitem", { name: "공간 A", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "이 공간 관리", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "공간 목록 · 새 공간", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "워크스페이스", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "공간 B", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${b}/tasks$`));
  if (info.project.name === "mobile") {
    await expect(page.getByRole("banner").getByText("공간 B", { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByText("공간 A", { exact: true })).toHaveCount(0);
  }
  await page.goto(`/w/${b}/settings`);
  const section = page.getByRole("region", { name: "워크스페이스", exact: true });
  await expect(section).toContainText("현재 공간 · 공간 B");
  await expect(section.getByRole("link", { name: "이 공간 관리", exact: true })).toHaveAttribute("href", `/w/${b}/manage`);
  await expect(section.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toHaveAttribute("href", "/workspaces");
  await openMainNavigation(page);
  await expect(navigation.getByRole("link", { name: "이 공간 관리", exact: true })).toHaveAttribute("href", `/w/${b}/manage`);
  await expect(navigation.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toHaveAttribute("href", "/workspaces");
  await page.keyboard.press("Escape");
  if (info.project.name === "desktop") {
    for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(section.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`settings-entry-${width}.png`), fullPage: true, animations: "disabled" });
      await openMainNavigation(page);
      const trigger = page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("button", { name: "공간 선택", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitem", { name: "공간 B", exact: true })).toHaveAttribute("aria-current", "page");
      await page.screenshot({ path: info.outputPath(`selection-entry-${width}.png`), fullPage: true, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      const sheet = page.getByRole("dialog", { name: "주 메뉴", exact: true });
      if (await sheet.isVisible()) await page.keyboard.press("Escape");
    }
  }
});

test("account space entry remains available without a space or settings permission", async ({ page }) => {
  const api = await fixture(page);
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  await page.route(`**/api/workspaces/${a}`, route => route.fulfill({ json: {
    workspace: { id: a, name: "공간 A", deleted_at: null }, membership_version: 1, can_manage: false,
    grants: [{ target_kind: "tasks", target_id: "*", access: "read" }],
  } }));
  await page.goto(`/w/${a}/settings`);
  const section = page.getByRole("region", { name: "워크스페이스", exact: true });
  await expect(section.getByRole("link", { name: "이 공간 관리", exact: true })).toHaveCount(0);
  await section.getByRole("link", { name: "공간 목록 · 새 공간", exact: true }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
  delete api.workspaces[a]; delete api.workspaces[b];
  await page.goto("/settings");
  await expect(section.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toHaveAttribute("href", "/workspaces");
  await openMainNavigation(page);
  await expect(navigation.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toHaveAttribute("href", "/workspaces");
  await navigation.getByRole("link", { name: "공간 목록 · 새 공간", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 공간 만들기", exact: true })).toBeVisible();
});

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
test("navigation follows the current space and grants despite a late old capability response", async ({ page }) => {
  const api = await fixture(page);
  const typeA = { ...fixtureType, label: "공간 A 자료" };
  const typeB = { ...fixtureType, id: "00000000-0000-4000-8000-000000000902", label: "공간 B 자료" };
  let holdA = false, readableB = true;
  let release!: () => void, arrived!: () => void, finished!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const settled = new Promise<void>(resolve => { finished = resolve; });
  await page.route(/\/api\/entity-types(?:\?.*)?$/, route => {
    const workspaceId = route.request().headers()["x-workspace-id"];
    expect([a, b]).toContain(workspaceId);
    return route.fulfill({ json: { items: [workspaceId === a ? typeA : typeB], next_cursor: null } });
  });
  await page.route(/\/api\/workspaces\/[0-9a-f-]{36}$/, async route => {
    const workspaceId = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (![a, b].includes(workspaceId) || route.request().method() !== "GET") return route.fallback();
    const held = workspaceId === a && holdA;
    if (held) { arrived(); await waiting; }
    const type = workspaceId === a ? typeA : typeB;
    try {
      await route.fulfill({ json: {
        workspace: { id: workspaceId, name: api.workspaces[workspaceId].name, deleted_at: null },
        membership_version: workspaceId === b && !readableB ? 2 : 1,
        can_manage: false,
        grants: [
          { target_kind: "tasks", target_id: "*", access: "write" },
          { target_kind: "entity_type", target_id: type.id, access: workspaceId === b && !readableB ? "none" : "read" },
        ],
      } });
    } catch (error) {
      if (!held) throw error;
    } finally {
      if (held) finished();
    }
  });
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  const link = (label: string) => navigation.getByRole("link", { name: label, exact: true });
  try {
    await page.goto(`/w/${a}/tasks`);
    await expect(page.getByText("space A task", { exact: true }).first()).toBeVisible();
    await openMainNavigation(page);
    await expect(link(typeA.label)).toHaveAttribute("href", `/w/${a}/entities?entity_type_id=${typeA.id}`);
    await expect(link(typeB.label)).toHaveCount(0);
    holdA = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await started;
    await choose(page, "공간 B");
    await expect(page).toHaveURL(new RegExp(`/w/${b}/tasks$`));
    await expect(page.getByText("space B task", { exact: true }).first()).toBeVisible();
    await openMainNavigation(page);
    await expect(link(typeB.label)).toHaveAttribute("href", `/w/${b}/entities?entity_type_id=${typeB.id}`);
    await expect(link(typeA.label)).toHaveCount(0);
    release();
    await settled;
    await expect(link(typeB.label)).toBeVisible();
    await expect(link(typeA.label)).toHaveCount(0);
    for (const readable of [false, true]) {
      readableB = readable;
      const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/${b}`);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await response;
      if (readable) await expect(link(typeB.label)).toBeVisible();
      else await expect(link(typeB.label)).toHaveCount(0);
      await expect(link(typeA.label)).toHaveCount(0);
      await expect(link("할 일")).toHaveAttribute("href", `/w/${b}/tasks`);
      await expect(link("할 일")).toHaveAttribute("aria-current", "page");
      await expect(page).toHaveURL(new RegExp(`/w/${b}/tasks$`));
    }
    expect(api.writes).toEqual([]);
    expect(api.errors).toEqual([]);
  } finally {
    release();
  }
});
test("workspace creation is explicit and its confirmed response selects the returned space", async ({ page }) => {
  const api = await fixture(page);
  delete api.workspaces[a];
  delete api.workspaces[b];
  await page.route(
    `**/api/workspaces/${a}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
          json: {
            workspace: { id: a, name: "새 공간", deleted_at: null },
            membership_version: 1,
            can_manage: true,
            grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
          },
        })
        : route.fallback(),
  );
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
  await expect(page).toHaveURL(new RegExp(`/w/${a}/manage$`));
  await expect(page.getByRole("heading", { name: "공간 관리", level: 1, exact: true })).toBeVisible();
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
              display_name: "김도윤",
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
      if (route.request().method() !== "POST") {
        return route.fulfill({
          json: { items: invitation ? [invitation] : [] },
        });
      }
      input = route.request().postDataJSON();
      invitation = {
        id: "00000000-0000-4000-8000-000000000990",
        workspace_id: a,
        version: 1,
        email: input!.email,
        grants: input!.grants,
        expires_at: "2099-01-01T00:00:00Z",
        revoked_at: null,
        accepted_at: null,
        accepted_by: null,
        delivery: { status: "pending" },
      };
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
    const membersTable = page.getByRole("table", {
      name: "참여자",
      exact: true,
    });
    await expect(membersTable).toBeVisible();
    await expect(membersTable.getByText("김도윤", { exact: true }))
      .toBeVisible();
    await expect(membersTable.getByText("설정 읽기·쓰기", { exact: true }))
      .toBeVisible();
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
    const invitationsTable = page.getByRole("table", {
      name: "초대",
      exact: true,
    });
    await expect(
      invitationsTable.getByText("guest@example.test", { exact: true }),
    ).toBeVisible();
    await expect(invitationsTable.getByText("할 일 읽기·쓰기", { exact: true }))
      .toBeVisible();
    await expect(page.getByText("보낸 초대가 없습니다.", { exact: true }))
      .toHaveCount(0);
    expect(input).toEqual({
      email: "guest@example.test",
      grants: [{ target_kind: "settings", target_id: "*", access: "none" }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }],
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("workspace-management-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: info.outputPath("workspace-management-desktop.png"),
      fullPage: true,
    });
  },
);

test(
  "an uncertain delivery retry cannot consume a member removal and keeps its original recovery",
  async ({ page }, info) => {
    await fixture(page);
    const invitationId = "00000000-0000-4000-8000-000000000990";
    const other = "00000000-0000-4000-8000-000000000902";
    const deliveries: {
      key: string | undefined;
      body: unknown;
      path: string;
    }[] = [];
    const removals: { key: string | undefined; body: unknown }[] = [];
    let removed = false, deliveryStatus = "failed";
    await page.route(
      "**/api/workspaces/*/members",
      (route) =>
        route.fulfill({
          json: {
            items: [
              {
                user_id: actor,
                display_name: "현재 관리자",
                version: 1,
                grants: [{
                  target_kind: "settings",
                  target_id: "*",
                  access: "write",
                }],
              },
              ...removed ? [] : [{
                user_id: other,
                display_name: "다른 참여자",
                version: 1,
                grants: [],
              }],
            ],
          },
        }),
    );
    await page.route(
      "**/api/workspaces/*/invitations",
      (route) =>
        route.fulfill({
          json: {
            items: [{
              id: invitationId,
              workspace_id: a,
              version: 1,
              email: "retry@example.test",
              grants: [],
              expires_at: "2099-01-01T00:00:00Z",
              revoked_at: null,
              accepted_at: null,
              accepted_by: null,
              delivery: { status: deliveryStatus },
            }, {
              id: "00000000-0000-4000-8000-000000000991",
              workspace_id: a,
              version: 1,
              email: "other-invite@example.test",
              grants: [],
              expires_at: "2099-01-01T00:00:00Z",
              revoked_at: null,
              accepted_at: null,
              accepted_by: null,
              delivery: { status: "failed" },
            }],
          },
        }),
    );
    await page.route(
      "**/api/workspaces/*/invitations/*/delivery",
      async (route) => {
        deliveries.push({
          key: route.request().headers()["idempotency-key"],
          body: route.request().postDataJSON(),
          path: new URL(route.request().url()).pathname,
        });
        if (deliveries.length === 1) {
          deliveryStatus = "pending";
          return route.abort("failed");
        }
        deliveryStatus = "pending";
        return route.fulfill({ json: { delivery: { status: "pending" } } });
      },
    );
    await page.route("**/api/workspaces/*/members/*", async (route) => {
      expect(route.request().method()).toBe("DELETE");
      removals.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      removed = true;
      return route.fulfill({ json: { removed: true } });
    });
    await page.goto(`/w/${a}/manage`);
    await page.getByRole("row").filter({ hasText: "retry@example.test" })
      .getByRole("button", { name: "이메일 전달 다시 요청", exact: true })
      .click();
    await expect(
      page.getByText("저장 여부를 알 수 없습니다.", { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "최신 상태 불러오기", exact: true })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: "retry@example.test" }).getByText(
        "이메일 전달 대기",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "other-invite@example.test" })
        .getByRole("button", { name: "이메일 전달 다시 요청", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("workspace-delivery-recovery-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("workspace-delivery-recovery-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1024, height: 800 });
    const otherRow = page.getByRole("row").filter({ hasText: "다른 참여자" });
    await otherRow.getByRole("button", { name: "제외", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", {
      name: /^(확인|같은 요청 다시 확인)$/,
    }).click();
    await expect.poll(() => removals.length).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/w/${a}/manage$`));
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const recover = page.getByRole("button", {
      name: "같은 이메일 전달 요청 다시 확인",
      exact: true,
    });
    await expect(recover).toBeEnabled();
    await recover.click();
    await expect.poll(() => deliveries.length).toBe(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    expect(removals[0]).toEqual({
      key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      body: { expected_version: 1 },
    });
    expect(removals[0].key).not.toBe(deliveries[0].key);
    await expect(page.getByText("다른 참여자", { exact: true })).toHaveCount(0);
    await expect(recover).toHaveCount(0);
  },
);
