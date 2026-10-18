import { chooseSetting } from "./settings-actions.ts";
import { executionDialog } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, unique, workspacePath, requiredEnv } from "./support.ts";
import { entityId, entityPath } from "../supabase/functions/_shared/contracts/entity-identity.ts";
import { analyzeAndApply } from "./entity-schema-support.ts";
import { beginTabAction, saveOnce } from "./ui-actions.ts";

let fixtureSource: string;
let fixtureType: { id: string; label: string } | undefined;
let workspace: Awaited<ReturnType<typeof ownedWorkspace>>;
test.beforeEach(async ({ page }) => {
  await devLogin(page);
  workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    fixtureType = await mcp.call("create_entity_type", { label: unique("식별 시험"), representative_label: "이름" }) as { id: string; label: string };
    await workspace.grantKind(fixtureType!.id);
    fixtureSource = `test_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
    await mcp.call("create_entity_issuer", { code: fixtureSource, label: "시험 마켓" });
    const rule = await mcp.call("create_entity_identifier_rule", { source: fixtureSource, label: "상품 번호", meaning: "시험 상품 번호" });
    await mcp.call("update_entity_type_identity", {
      type_id: fixtureType!.id, label: "자료 번호", default_source: fixtureSource, expected_version: 1,
      sources: [{ code: fixtureSource, rule_id: rule.id, active: true }],
    });
    const change = await mcp.call("create_entity_schema_change", {
      type_id: fixtureType!.id, expected_schema_version: 1,
      edits: [
        { op: "add_property", client_ref: "count", field: { "x-order": 20, type: ["integer", "null"], title: "개수", default: 0 }, required: false },
        { op: "add_property", client_ref: "date", field: { "x-order": 30, type: ["string", "null"], format: "date", title: "날짜" }, required: false },
        { op: "add_property", client_ref: "category", field: { "x-order": 40, type: "string", oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }], title: "구분", default: "a" }, required: false },
      ],
    });
    await analyzeAndApply(mcp, fixtureType!.id, change.id, change.version);
  } finally {
    await mcp.close();
  }
});

test("manual tuple registration restores stored properties and links while identity remains immutable", async ({ page }) => {
  await page.goto(workspacePath(workspace.id, "/tasks"));
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await workspace.fetch(method, path, data);
    expect(response.ok()).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  };
  const original = await api("GET", "/settings/business");
  const external_id = `000Ab:/한글%${unique("자료 번호")}`,
    name = unique("보관 자료");
  let entityId: string | undefined, taskId: string | undefined;
  try {
    await api("PATCH", "/settings/business", {
      id: "record_templates",
      expected_version: original.versions.record_templates,
      value: {
        ...original.settings.record_templates,
        entity_types: {
          ...original.settings.record_templates?.entity_types,
          [fixtureType!.id]: { delete: { memo: "삭제 템플릿", tag_ids: [] } },
        },
      },
    });
    const target = await api("POST", "/entities", {
      source: fixtureSource,
      external_id,
      entity_type_id: fixtureType!.id,
      schema_version: 2,
      properties: { prop_1: name, prop_2: 0, prop_4: "c" },
    });
    entityId = target.id;
    const task = await api("POST", "/tasks", {
      kind: "once",
      title: unique("연결 보존"),
      entity_ids: [target.id],
    });
    taskId = task.id;
    await api("POST", `/entities/${encodeURIComponent(target.id)}/delete`, {
      expected_version: 1,
    });
    await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${fixtureType!.id}`));
    // Hold the settings response to verify identity inputs cannot race loaded defaults.
    let releaseSettings!: () => void;
    const settingsReady = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
    await page.route(`**/entity-types/${fixtureType!.id}/identity`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await settingsReady;
      await route.continue();
    });
    await beginTabAction(page, `${fixtureType!.label} 추가`);
    const form = page.getByRole("dialog", {
      name: `${fixtureType!.label} 추가`,
      exact: true,
    });
    await expect(form.getByLabel("번호", { exact: true })).toBeDisabled();
    await expect(
      form.getByRole("button", { name: "기존 대상 확인", exact: true }),
    ).toHaveCount(0);
    releaseSettings();
    await expect(form.getByLabel("자료 번호")).toBeEnabled();
    await expect(form.getByRole("button", { name: "기존 대상 확인", exact: true })).toHaveCount(0);
    await form.getByLabel("자료 번호").fill(external_id);
    await form.getByRole("button", { name: "기존 대상 확인", exact: true })
      .click();
    const restore = page.getByRole("dialog", {
      name: `${fixtureType!.label} 복원`,
      exact: true,
    });
    await expect(restore.getByLabel("이름", { exact: false })).toHaveValue(
      name,
    );
    await expect(restore.getByLabel("개수")).toHaveValue("0");
    await expect(restore.getByLabel("구분")).toHaveValue("value:c");
    await restore.getByRole("textbox", { name: "날짜", exact: true }).fill("2026-10-09");
    await saveOnce(page, restore);
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    const restored = await api(
      "GET",
      `/entities/${encodeURIComponent(target.id)}`,
    );
    expect([
      restored.deleted_at,
      restored.version,
      restored.properties.prop_2,
      restored.properties.prop_4,
    ]).toEqual([
      null,
      3,
      0,
      "c",
    ]);
    expect((await api("GET", `/tasks/${task.id}`)).entity_ids).toEqual([
      target.id,
    ]);
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const rekey = page.getByRole("dialog", {
      name: `${fixtureType!.label} 편집`,
      exact: true,
    });
    await expect(rekey.locator("dt:visible", { hasText: /^자료 번호$/ }).locator("../dd")).toHaveText(external_id);
    await expect(rekey.getByRole("textbox", { name: "자료 번호", exact: true })).toHaveCount(0);
    await rekey.getByLabel("이름", { exact: false }).fill(name + " 수정");
    await saveOnce(page, rekey);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(target.id)));
    expect((await api("GET", `/tasks/${task.id}`)).entity_ids).toEqual([target.id]);
    expect((await api("GET", `/entities/${encodeURIComponent(target.id)}`)).external_id).toBe(external_id);
    const rejected = await workspace.fetch("PATCH", `/entities/${encodeURIComponent(target.id)}`, { external_id: "새 번호", expected_version: 4 });
    expect(rejected.status()).toBe(400);
    await expect(page.getByText(name + " 수정", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(name + " 수정", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const deletion = executionDialog(page);
    await expect(deletion.getByLabel("기록 메모", { exact: true })).toHaveValue(
      "삭제 템플릿",
    );
    await deletion.getByLabel("기록 메모", { exact: true }).fill("");
    const request = page.waitForRequest((value) => value.method() === "POST" && value.url().endsWith("/delete"));
    await deletion.getByRole("button", { name: "삭제하고 기록", exact: true })
      .click();
    expect((await request).postDataJSON().change_note).toBe("");
    await expect(deletion).toHaveCount(0);
    const events = await api("GET", "/records?record_kind=change&limit=100");
    const deletionEvent = events.items.find((
      event: { change?: { target_id: string; action: string } },
    ) => {
      const change = event.change;
      return !!change && change.target_id === entityId && change.action === "delete";
    });
    expect(deletionEvent.body).not.toBe("삭제 템플릿");
    expect(deletionEvent.body).toContain(name);
  } finally {
    if (taskId) {
      const task = await api("GET", `/tasks/${taskId}`);
      await api("POST", `/tasks/${taskId}/delete`, {
        expected_version: task.version,
      });
    }
    if (entityId) {
      const target = await api(
        "GET",
        `/entities/${encodeURIComponent(entityId)}`,
      );
      if (!target.deleted_at) {
        await api("POST", `/entities/${encodeURIComponent(entityId)}/delete`, {
          expected_version: target.version,
        });
      }
    }
    const latest = await api("GET", "/settings/business");
    await api("PATCH", "/settings/business", {
      id: "record_templates",
      expected_version: latest.versions.record_templates,
      value: original.settings.record_templates ?? {},
    });
  }
});

test("kind identity settings retries a failed read and saves a label without changing stored identity", async ({ page }) => {
  await page.goto(workspacePath(workspace.id, "/tasks"));
  let fail = true;
  await page.route(`**/entity-types/${fixtureType!.id}/identity`, async (route) => {
    if (route.request().method() === "GET" && fail) return route.abort("failed");
    await route.continue();
  });
  await page.goto(workspacePath(workspace.id, `/settings/entity-types/${fixtureType!.id}`));
  const section = page.getByRole("region", { name: "자료 번호", exact: true });
  await section.getByRole("button", { name: /^자료 번호/ }).click();
  await expect(section.getByRole("alert")).toBeVisible();
  fail = false;
  await section.getByRole("button", { name: "자료 번호 설정 다시 조회", exact: true }).click();
  await section.getByLabel("이름", { exact: false }).fill("상품 번호");
  await section.getByRole("button", { name: "자료 번호 저장", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("자료 번호 설정을 저장했습니다.");
  await page.reload();
  await section.getByRole("button", { name: /^자료 번호/ }).click();
  await expect(section.getByLabel("이름", { exact: false })).toHaveValue("상품 번호");
});

test("late archived lookup preserves newer identity and same-identity property edits", async ({ page }) => {
  await page.goto(workspacePath(workspace.id, "/tasks"));
  await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${fixtureType!.id}`));
  await beginTabAction(page, `${fixtureType!.label} 추가`);
  const form = () =>
    page.getByRole("dialog", {
      name: `${fixtureType!.label} 추가`,
      exact: true,
    });
  await expect(form().getByLabel("자료 번호")).toBeEnabled();
  await expect(form().getByText("시험 마켓", { exact: true })).toBeVisible();
  await expect(form().getByRole("combobox", { name: "번호 출처", exact: false })).toHaveCount(0);
  const source = fixtureSource;
  const identity = unique("지연 자료 번호");
  const held: (() => Promise<void>)[] = [];
  let lookupNumber = 0;
  const lookupUrl = `${requiredEnv("VITE_API_URL")}${entityPath(entityId(source, fixtureType!.id, identity))}`;
  await page.route(lookupUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const number = ++lookupNumber;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivered!: () => void;
    const done = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    held.push(async () => {
      release();
      await done;
    });
    await gate;
    await route.fulfill({
      json: {
        id: `${source}:${fixtureType!.id}:${identity}`,
        source,
        external_id: identity,
        entity_type_id: fixtureType!.id,
        type: {
          id: fixtureType!.id,
          label: fixtureType!.label,
          icon_id: "box",
          archived: false,
        },
        schema_version: 2,
        current_schema_version: 2,
        title: `보관된 값 ${number}`,
        properties: {
          prop_1: `보관된 값 ${number}`,
          prop_2: 0,
          prop_3: null,
          prop_4: "a",
        },
        display_properties: { prop_1: `보관된 값 ${number}` },
        source_label: source,
        tasks: { count: 0, items: [] },
        records: { count: 0, items: [] },
        tag_ids: [],
        version: 2,
        deleted_at: "2026-10-10T00:00:00Z",
        created_at: "2026-10-10T00:00:00Z",
        updated_at: "2026-10-10T00:00:00Z",
      },
    });
    delivered();
  });
  const start = async () => {
    const ordinal = lookupNumber + 1, pendingCount = held.length;
    const requested = page.waitForRequest((value) => value.method() === "GET" && value.url() === lookupUrl && value.headers()["x-workspace-id"] === workspace.id);
    await form().getByRole("button", { name: "기존 대상 확인", exact: true })
      .click();
    await requested;
    // The browser request event precedes route-handler admission; wait for this exact new held lookup.
    await expect.poll(() => lookupNumber).toBe(ordinal);
    await expect.poll(() => held.length).toBe(pendingCount + 1);
  };
  const settle = async (index = 0) => {
    await held.splice(index, 1)[0]();
    // Let React commit the response before checking the still-current input.
    await page.evaluate(() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
  };
  await form().getByLabel("자료 번호").fill(identity);
  await start();
  await form().getByLabel("자료 번호").fill("다른 자료 번호");
  await form().getByLabel("이름", { exact: false }).fill("새 입력");
  await settle();
  await expect(form().getByLabel("자료 번호")).toHaveValue("다른 자료 번호");
  await expect(form().getByLabel("이름", { exact: false })).toHaveValue(
    "새 입력",
  );

  await form().getByLabel("자료 번호").fill(identity);
  await start();
  await form().getByLabel("이름", { exact: false }).fill(
    "같은 자료 번호에서 수정",
  );
  await settle();
  await expect(form().getByLabel("이름", { exact: false })).toHaveValue(
    "같은 자료 번호에서 수정",
  );
  await start();
  await start();
  await settle(1);
  const restore = page.getByRole("dialog", {
    name: `${fixtureType!.label} 복원`,
    exact: true,
  });
  await expect(restore.getByLabel("이름", { exact: false })).toHaveValue(
    "보관된 값 4",
  );
  await settle();
  await expect(restore.getByLabel("이름", { exact: false })).toHaveValue(
    "보관된 값 4",
  );
  await restore.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  if (await discard.isVisible()) {
    await discard.getByRole("button", { name: "변경 버리기", exact: true })
      .click();
  }
  await beginTabAction(page, `${fixtureType!.label} 추가`);
  await expect(form().getByLabel("자료 번호")).toBeEnabled();
  await form().getByLabel("자료 번호").fill(identity);
  await start();
  await form().getByRole("button", { name: "취소", exact: true }).click();
  if (await discard.isVisible()) {
    await discard.getByRole("button", { name: "변경 버리기", exact: true })
      .click();
  }
  await beginTabAction(page, `${fixtureType!.label} 추가`);
  await expect(form().getByLabel("자료 번호")).toBeEnabled();
  const newIdentity = await form().getByLabel("자료 번호").inputValue();
  await settle();
  await expect(form().getByLabel("자료 번호")).toHaveValue(newIdentity);
  await expect(form().getByLabel("이름", { exact: false })).toHaveValue("");
});

test("manual lookup pending before confirmation cannot replace the prepared entity", async ({ page }) => {
  await page.goto(workspacePath(workspace.id, "/tasks"));
  await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${fixtureType!.id}`));
  await beginTabAction(page, `${fixtureType!.label} 추가`);
  const form = page.getByRole("dialog", {
    name: `${fixtureType!.label} 추가`,
    exact: true,
  });
  await expect(form.getByLabel("자료 번호")).toBeEnabled();
  await expect(form.getByText("시험 마켓", { exact: true })).toBeVisible();
  await expect(form.getByRole("combobox", { name: "번호 출처", exact: false })).toHaveCount(0);
  const source = fixtureSource;
  const identity = unique("확인 중 조회"), title = unique("지킬 입력");
  await form.getByLabel("자료 번호").fill(identity);
  await form.getByLabel("이름", { exact: false }).fill(title);
  let release!: () => void, delivered!: () => void, reads = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route("**/entities/*", async (route) => {
    if (route.request().method() !== "GET" || ++reads !== 1) {
      return route.continue();
    }
    await gate;
    await route.fulfill({
      json: {
        id: `${source}:${fixtureType!.id}:${identity}`,
        source,
        external_id: identity,
        entity_type_id: fixtureType!.id,
        type: {
          id: fixtureType!.id,
          label: fixtureType!.label,
          icon_id: "box",
          archived: false,
        },
        schema_version: 2,
        current_schema_version: 2,
        title: "옛 보관값",
        properties: {
          prop_1: "옛 보관값",
          prop_2: 0,
          prop_3: null,
          prop_4: "a",
        },
        display_properties: { prop_1: "옛 보관값" },
        source_label: source,
        tasks: { count: 0, items: [] },
        records: { count: 0, items: [] },
        tag_ids: [],
        version: 2,
        deleted_at: "2026-10-10T00:00:00Z",
        created_at: "2026-10-10T00:00:00Z",
        updated_at: "2026-10-10T00:00:00Z",
      },
    });
    delivered();
  });
  const started = page.waitForRequest((value) => value.method() === "GET" && value.url().includes("/entities/"));
  await form.getByRole("button", { name: "기존 대상 확인", exact: true })
    .click();
  await started;
  const prepared = page.waitForResponse((value) =>
    value.request().method() === "POST" &&
    value.url().endsWith("/records/prepare")
  );
  await form.getByRole("button", { name: "저장", exact: true }).click();
  const defaults = await (await prepared).json();
  const confirmation = executionDialog(page);
  const target = confirmation.getByRole("term").filter({ hasText: /^대상$/ })
    .locator("..").getByRole("definition");
  expect(defaults.prepared_input).toMatchObject({
    entity_type_id: fixtureType!.id,
    source,
    external_id: identity,
    properties: { prop_1: title },
  });
  await expect(target).toHaveText(title);
  await expect(confirmation.getByLabel("기록 메모", { exact: true }))
    .toHaveValue(defaults.change_note);
  release();
  await done;
  await page.evaluate(() =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  await expect(
    confirmation.getByRole("button", { name: "등록하고 저장", exact: true }),
  ).toBeEnabled();
  await expect(target).toHaveText(title);
  await expect(confirmation.getByLabel("기록 메모", { exact: true }))
    .toHaveValue(defaults.change_note);
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("이름", { exact: false })).toHaveValue(title);
});

test("seven settings workspaces retain real API selections and stay within the viewport", async ({ page }, info) => {
  await page.goto(workspacePath(workspace.id, "/tasks"));
  for (
    const [path, title] of [
      ["/settings", "기본 설정"],
      [`/settings/entity-types/${fixtureType!.id}`, "자료 설정"],
      ["/settings/tags", "태그 설정"],
      ["/settings/records", "기록 설정"],
      ["/settings/issuers", "자료 설정"],
      ["/settings/relations", "자료 설정"],
      ["/settings/data-model", "자료 설정"],
    ]
  ) {
    await page.goto(workspacePath(workspace.id, path));
    await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
    const menu = page.getByRole("menu", { name: "설정 메뉴", exact: true });
    const destinations = [
      ["기본", "/settings"],
      ["자료", "/settings/materials"],
      ["태그", "/settings/tags"],
      ["기록", "/settings/records"],
    ] as const;
    await expect(menu.getByRole("menuitem")).toHaveCount(4);
    await expect(menu.getByRole("menuitem")).toHaveText(destinations.map(([label]) => label));
    for (const [label, href] of destinations) {
      await expect(menu.getByRole("menuitem", { name: label, exact: true })).toHaveAttribute("href", workspacePath(workspace.id, href));
    }
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(page.getByRole("button", { name: "설정 메뉴", exact: true })).toBeFocused();
    if (path === `/settings/entity-types/${fixtureType!.id}`) {
      const identity = page.getByRole("region", { name: "자료 번호", exact: true });
      const disclosure = identity.getByRole("heading", { level: 2 }).getByRole("button", { name: /^자료 번호/ });
      if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
      await expect(identity.getByLabel("이름", { exact: false })).toHaveValue("자료 번호");
      await expect(identity.getByRole("radio", { name: "시험 마켓 기본 번호 출처", exact: true })).toBeChecked();
      await expect(page.getByRole("region", { name: "기록 자동 완성", exact: true })).toHaveCount(0);
    }
    if (title === "기록 설정") {
      await chooseSetting(page, page.getByLabel("대상", { exact: true }), fixtureType!.label);
      const template = page.getByRole("form", { name: "기록 자동 완성", exact: true });
      await expect(template).toBeVisible();
      await expect(template.getByLabel("액션", { exact: true })).toBeEnabled();
      await expect(template.getByLabel("메모 템플릿")).toHaveText("대상 액션");
      await expect(
        page.getByRole("status").filter({
          hasText: /^(?:설정을 읽는 중|입력 항목 정의를 읽는 중|태그를 불러오는 중)…$/,
        }),
      ).toHaveCount(0);
    }
    if (path === "/settings/issuers") {
      await page.getByRole("button", { name: "시험 마켓", exact: true }).click();
      await expect(page.getByText("상품 번호", { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`${path.slice(1).replaceAll("/", "-")}.png`), fullPage: true });
  }
  // Material workspaces share the official tabs rather than separate global menu items.
  for (const [label, path] of [
    ["자료 종류", "/settings/materials"],
    ["연결 설정", "/settings/relations"],
    ["번호 설정", "/settings/issuers"],
    ["일괄 설정", "/settings/data-model"],
  ] as const) {
    const tabs = page.getByRole("tablist", { name: "자료 설정 항목", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    await expect(tabs.getByRole("tab")).toHaveText(["자료 종류", "연결 설정", "번호 설정", "일괄 설정"]);
    await tabs.getByRole("tab", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { name: "자료 설정", level: 1, exact: true })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
  }
});
