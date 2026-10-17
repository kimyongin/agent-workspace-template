import { entityKey } from "./workspace-data.ts";
import { openDetailEditor } from "../ui-actions.ts";
import { expect, type Page } from "@playwright/test";
import { base, entity, fixtureType, id,  record, stamp, task, type WorkspaceRows } from "./workspace-data.ts";
import { installWorkspaceApi } from "./workspace-api.ts";

export const targetCases = [["entity", "entities", 1], ["task", "tasks", 2], ["record", "records", 31]] as const;

export const connectedTarget = (page: Page, kind: typeof targetCases[number][0]) =>
  form(page).getByRole("region", {
    name: `${{ entity: "연결된 자료", task: "할 일", record: "기록" }[kind]} (1개)`,
    exact: true,
  });

export async function fixtures(
  page: Page,
  options: { long?: boolean; failWrite?: "unknown" | "conflict"; hold?: boolean } = {},
) {
  const user = {
    id: id(901), aud: "authenticated", email: "workspace-screens@example.test",
    app_metadata: {}, user_metadata: {},
  };
  // These screens represent a logged-in workspace. Individual account fixtures may override it.
  await page.addInitScript((user) => {
    if (localStorage.getItem("sb-127-auth-token")) return;
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "workspace-screens-fixture-access", refresh_token: "workspace-screens-fixture-refresh",
      token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, user);
  await page.route("http://127.0.0.1:55581/auth/v1/user", (route) => route.fulfill({ json: user }));
  const rows: WorkspaceRows = {
    entities: [entity()],
    tasks: [task()],
    records: [record()],

    tags: [{ ...base(10, ""), name: "같은 이름", scope: "entity" }, {
      ...base(11, ""),
      name: "같은 이름",
      scope: "record",
    }, { ...base(12, ""), name: "같은 이름", scope: "task" }],
  };
  if (options.long) {
    rows.entities[0].properties.prop_1 = rows.entities[0].title = "긴제목".repeat(25);
    rows.entities[0].display_properties.prop_1 = rows.entities[0].title;
    for (const row of [...rows.tasks, ...rows.records]) {
      row.body = "긴 본문\n\n".repeat(150);
      if ("title" in row) row.title = "긴제목".repeat(32);
    }
  }
  await page.route("http://127.0.0.1:55580/**", async (route) => {
    if (route.request().isNavigationRequest()) {
      const response = await route.fetch({ url: "http://127.0.0.1:55580/e2e/fixtures/workspace-screens.html" });
      await route.fulfill({ response });
    } else await route.continue();
  });
  return installWorkspaceApi(page, "http://127.0.0.1:55581", rows, options);
}

export const go = async (page: Page, path: string) => {
  const url = new URL(path, "http://fixture.test");
  if (url.pathname === "/entities" && !url.searchParams.has("entity_type_id")) url.searchParams.set("entity_type_id", "00000000-0000-4000-8000-000000000900");
  return page.goto(url.pathname + url.search + url.hash);
};

export const form = (page: Page) => page.getByRole("dialog").filter({ visible: true }).last();

export function linkedFixture(state: Awaited<ReturnType<typeof fixtures>>) {
  Object.assign(state.rows.entities[0], {
    tasks: { count: 1, items: [{ id: id(2), title: "할 일", updated_at: stamp }] },
    records: { count: 1, items: [record()] },
  });
  Object.assign(state.rows.tasks[0], {
    entity_ids: [entityKey(1)],
    entity_context: [{ id: entityKey(1), title: "자료", type: fixtureType, schema_version: 1, source: "selection", captured_at: stamp }],
  });
  Object.assign(state.rows.records[0], {
    entity_ids: [entityKey(1)],
    entity_context: [{ id: entityKey(1), title: "자료", type: fixtureType, schema_version: 1, source: "selection", captured_at: stamp }],
    task_id: id(2),
  });
}

export async function compatibleEdit(page: Page) {
  if (new URL(page.url()).searchParams.get("edit") === "1") {
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeVisible();
  } else await openDetailEditor(page);
}

export async function fillText(page: Page, title = "새 자료") {
  await expect(form(page).locator("form")).toBeVisible();
  const input = form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ });
  if (await input.count()) await input.fill(title);
  await form(page).getByRole("textbox", { name: /^본문(?: \(필수\))?$/ }).fill(title);
}
