import type { Page } from "@playwright/test";
import { installWorkspaceApi } from "./workspace-api.ts";
import { task, type WorkspaceRows } from "./workspace-data.ts";

export const a = "00000000-0000-4000-8000-000000000981",
  b = "00000000-0000-4000-8000-000000000982";
export const actor = "00000000-0000-4000-8000-000000000901";
export function rows(title: string): WorkspaceRows {
  return { entities: [], tags: [], records: [], tasks: [{ ...task(), title }] };
}
export async function fixture(page: Page) {
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
