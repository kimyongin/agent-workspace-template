import { detailDialog, executionDialog } from "./ui-actions.ts";
import { setEntityCategory } from "./ui-actions.ts";
import { entity as makeEntity, fixtureSchema, fixtureType } from "./support/workspace-data.ts";
import {
  analyzeAndApply,
  createFixtureEntity,
  fixtureEntityList,
  scalarFixtureType,
  seedFixtureEntities,
} from "./entity-schema-support.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import {
  beginTabAction,
  closeDetail,
  openDetailEditor,
  openListDetail,
  openTabFilters,
  saveOnce,
} from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";

test("Entity 웹 CRUD·초안 보호→MCP parity·활동 연결→삭제 원문 보존", async ({ page }) => {
  await devLogin(page);
  const fixtureMcp = await mcpClient(await mcpTokenViaConsent(page));
  const fixtureType = await scalarFixtureType(fixtureMcp);
  await page.goto(fixtureEntityList(fixtureType.id));
  await fixtureMcp.close();
  await beginTabAction(page, "검사 자료 추가");
  const form = page.getByRole("dialog", { name: /^검사 자료.* 추가$/ }),
    name = unique("예제 엔터티");
  await form.getByLabel("제목").fill(name);
  await form.getByLabel("수량").fill("0");
  await form.getByLabel("날짜").fill("2024-02-29");
  await form.getByLabel("분류").selectOption("b");
  await form.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole(
    "button",
    { name: "취소", exact: true },
  ).click();
  await expect(form.getByLabel("제목")).toHaveValue(name);
  await saveOnce(page, form);
  await expect(form).not.toBeVisible();
  await expect(page).toHaveURL(/\/entities\/[^/?]+%3A[0-9]{8}-[0-9A-Z]{8}(?:\?|$)/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const id = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const e = await mcp.call("get_entity", { id });
    expect(e.properties.prop_2).toBe(0);
    expect(e.properties.prop_3).toBe("2024-02-29");
    const task = await mcp.call("create_task", {
      kind: "once",
      title: unique("연결 행동"),
      body: "연결을 보존",
      entity_ids: [id],
    });
    const unrelated = await mcp.call("create_task", { kind: "once", title: task.title + " 외부", body: "별도" });
    await page.goto(`/search?q=${encodeURIComponent(task.title)}&mode=keyword&kind=task`);
    await openTabFilters(page);
    await page.getByLabel("자료", { exact: true }).selectOption(id);
    await page.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(page.locator("[data-list-anchor]")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id);
    const detailRead = page.waitForRequest((request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname.endsWith(`/tasks/${task.id}`)
    );
    await page.getByRole("link", { name: task.title, exact: true }).click();
    const detailResponse = await (await detailRead).response();
    expect(detailResponse?.status()).toBe(200);
    await detailResponse!.finished();
    await closeDetail(page, task.title);
    await expect(page.getByRole("link", { name: task.title, exact: true })).toBeFocused();
    await page.reload();
    await expect(page.locator("[data-list-anchor]")).toHaveCount(1);
    expect(
      (await mcp.call("search", { query: task.title, entity_id: id, mode: "keyword", kinds: ["task"] })).items.map((
        x: { id: string },
      ) => x.id),
    ).toEqual([task.id]);
    await mcp.call("delete_task", { id: unrelated.id, expected_version: 1 });
    await page.goto(`/entities/${encodeURIComponent(id)}`);
    await expect(page.getByRole("heading", { name: "할 일 (1개)" }))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "전체 할 일 보기" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: task.title, exact: true })).toBeVisible();
    await page.goto(`/tasks?entity_id=${encodeURIComponent(id)}`);
    expect(new URL(page.url()).pathname).toBe("/tasks");
    await expect(page.getByRole("button", { name: task.title, exact: true }))
      .toBeVisible();
    expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id);
    await page.goto(`/tasks/${task.id}`);
    await openDetailEditor(page);
    const editTask = page.getByRole("dialog", { name: "할 일 편집" });
    await expect(editTask.getByRole("searchbox", { name: "자료 제목 검색" })).toHaveCount(0);
    expect((await mcp.call("get_task", { id: task.id })).entity_ids).toEqual([id]);
    await closeDetail(page, task.title);
    await page.goto(`/entities/${encodeURIComponent(id)}`);
    await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: /^검사 자료.* 편집$/ });
    await edit.getByLabel("수량").fill("10");
    await fillChangeMemo(page, edit, "실측 반영");
    await saveOnce(page, edit);
    await expect(edit).not.toBeVisible();
    expect((await mcp.call("get_entity", { id })).properties.prop_2).toBe(10);
    await page.goto(`/entities/${encodeURIComponent(id)}`);
    await openDetailEditor(page);
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const remove = executionDialog(page);
    await remove.getByRole("button", { name: "취소", exact: true }).click();
    await expect(detailDialog(page).getByLabel("제목")).toHaveValue(name);
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await saveOnce(page, executionDialog(page), "삭제 확인");
    await expect(
      page.getByRole("heading", { name: "전체 자료", level: 1, exact: true }),
    )
      .toBeVisible();
    const current = await mcp.call("get_task", { id: task.id });
    expect(current.entity_ids).toEqual([id]);
    expect(current.entity_context).toContainEqual(expect.objectContaining({ id, title: name }));
    expect(current).not.toHaveProperty("entity_id");
    expect(current.version).toBe(1);
    await mcp.call("delete_task", { id: task.id, expected_version: 1 });
  } finally {
    await mcp.close();
  }
});

test("엔터티 관련 기록 취소: 작성 URL·reload·메모와 변경 이벤트 무쓰기", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const entity = await createFixtureEntity(mcp, { prop_1: unique("연결 취소"), prop_2: 0, prop_4: "a" });
    const before = await mcp.call("list_records", { entity_id: entity.id, record_kind: "change", limit: 100 });
    await page.goto(`/entities/${encodeURIComponent(entity.id)}?list=%2Fentities`);
    for (const dirty of [false, true]) {
      await beginTabAction(page, "기록 작성");
      const editor = page.getByRole("dialog", { name: "기록 작성", exact: true });
      await expect(page).toHaveURL(/create=record/);
      if (dirty) await editor.getByLabel("본문").fill("취소할 설명");
      await editor.getByRole("button", { name: "취소", exact: true }).click();
      if (dirty) {
        await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" })
          .click();
      }
      await expect(page).not.toHaveURL(/create=/);
      await expect(page).toHaveURL(/list=/);
      await expect(page.getByRole("button", { name: "기록 작성", exact: true })).toBeFocused();
    }
    // Reload commits a new document; verify its rendered target rather than
    // capturing a previous document's final request while it is unloading.
    await page.reload();
    await expect(page.getByRole("heading", { name: entity.title, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "기록 작성", exact: true })).toHaveCount(0);
    expect((await mcp.call("get_entity", { id: entity.id })).version).toBe(1);
    expect((await mcp.call("list_records", { entity_id: entity.id, record_kind: "user" })).items).toEqual([]);
    expect((await mcp.call("list_records", { entity_id: entity.id, record_kind: "change", limit: 100 })).items).toEqual(
      before.items,
    );
  } finally {
    await mcp.close();
  }
});
test("Entity 목록: 키워드/선택/정렬·추가 페이지·상세 복귀/새로고침 초점·viewport", async ({ page }) => {
  await devLogin(page);
  const token = await mcpTokenViaConsent(page);
  const ownerId: string = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
  const mcp = await mcpClient(token), marker = unique("페이지 엔터티"), ids: string[] = [];
  try {
    ids.push(
      ...await seedFixtureEntities(
        mcp,
        ownerId,
        Array.from({ length: 21 }, (_, i) => ({
          prop_1: `${marker} ${String(i).padStart(2, "0")}`,
          prop_2: i,
          prop_4: "c",
        })),
      ),
    );
    await page.goto(
      fixtureEntityList((await scalarFixtureType(mcp)).id, marker, "c", true),
    );
    await expect(page.getByRole("button", { name: `${marker} 00`, exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    const last = page.getByRole("button", { name: `${marker} 20`, exact: true });
    await expect(last).toBeVisible();
    const before = page.url();
    await openListDetail(page, `${marker} 20`);
    await closeDetail(page, `${marker} 20`);
    const restored = new URL(page.url()), original = new URL(before);
    for (const [key, value] of original.searchParams) expect(restored.searchParams.get(key)).toBe(value);
    expect(restored.searchParams.has("scroll")).toBe(true);
    await expect(last).toBeFocused();
    await page.reload();
    await expect(last).toBeFocused();
    for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.goto(fixtureEntityList((await scalarFixtureType(mcp)).id, marker, "c", true));
    await openListDetail(page, `${marker} 19`);
    const concurrent = await createFixtureEntity(mcp, { prop_1: `${marker} 새 항목`, prop_2: 0, prop_4: "c" });
    ids.push(concurrent.id);
    await closeDetail(page, `${marker} 19`);
    await expect(page.getByRole("button", { name: `${marker} 19`, exact: true })).toBeFocused();
    await mcp.call("delete_entity", { id: ids[19], expected_version: 1 });
    ids.splice(19, 1);
    const reloaded = page.waitForRequest((request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname.endsWith("/entities") &&
      new URL(request.url()).searchParams.get("keyword") === marker
    );
    await page.reload();
    const read = await (await reloaded).response();
    expect(read?.status()).toBe(200);
    await read!.finished();
    await expect(page.getByRole("heading", { name: (await scalarFixtureType(mcp)).label, level: 1, exact: true }))
      .toBeFocused();
  } finally {
    // The serial owned fixture releases exactly these rows after all browser work ends.
    await mcp.close();
  }
});

test("Entity 복원: 대상 없음 조회 한도·제목 초점·필터 hash 제거·늦은 응답 격리", async ({ page }) => {
  await devLogin(page);
  let requests = 0, release: () => void = () => {}, started: () => void = () => {};
  const delayed = new Promise<void>((resolve) => release = resolve),
    arrived = new Promise<void>((resolve) => started = resolve);
  await page.route(
    "**/api/entity-types**",
    (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/entity-types")
          ? { items: [fixtureType], next_cursor: null }
          : new URL(route.request().url()).pathname.endsWith("/schema")
          ? fixtureSchema
          : fixtureType,
      }),
  );
  await page.route("**/api/entities?**", async (route) => {
    const url = new URL(route.request().url()), keyword = url.searchParams.get("keyword");
    requests++;
    if (keyword === "느림") {
      started();
      await delayed;
    }
    const externalId = crypto.randomUUID();
    const item = {
      ...makeEntity(1, { prop_1: keyword ?? "계속되는 목록" }),
      id: `app:${makeEntity(1).entity_type_id}:${externalId}`,
      external_id: externalId,
    };
    await route.fulfill({ json: { items: [item], next_cursor: keyword ? null : "more" } }).catch(() => {});
  });
  await page.goto(
    `/entities?pages=1#entity-${encodeURIComponent(`app:${makeEntity(1).entity_type_id}:${crypto.randomUUID()}`)}`,
  );
  await expect(page.getByRole("heading", { name: "전체 자료", level: 1, exact: true })).toBeFocused();
  expect(requests).toBe(2);
  await openTabFilters(page);
  await setEntityCategory(page, "b");
  await expect(page).not.toHaveURL(/#entity-/);
  expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
  await page.getByLabel("자료 제목 검색", { exact: true }).fill("느림");
  await arrived;
  await page.getByLabel("자료 제목 검색", { exact: true }).fill("최신");
  await expect(page.getByRole("button", { name: "최신", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "느림", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "최신", exact: true })).toBeVisible();
});

test("Entity lookahead 뒤 더 보기: 현재 커서 append·실패 retry·행과 버튼 초점 보존", async ({ page }) => {
  await devLogin(page);
  const token = await mcpTokenViaConsent(page);
  const ownerId: string = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
  const mcp = await mcpClient(token), marker = unique("복원 후 추가"), ids: string[] = [];
  try {
    ids.push(
      ...await seedFixtureEntities(
        mcp,
        ownerId,
        Array.from({ length: 61 }, (_, i) => ({
          prop_1: `${marker} ${String(i).padStart(2, "0")}`,
          prop_2: i,
        })),
      ),
    );
    await page.goto(fixtureEntityList((await scalarFixtureType(mcp)).id, marker, undefined, true));
    const anchor = page.getByRole("button", { name: `${marker} 19`, exact: true });
    await openListDetail(page, `${marker} 19`);
    ids.push((await createFixtureEntity(mcp, { prop_1: `${marker} 동시 추가`, prop_2: 0 })).id);
    await closeDetail(page, `${marker} 19`);
    await expect(anchor).toBeFocused();
    await expect(page.locator("[data-list-anchor]")).toHaveCount(40);
    const more = page.getByRole("button", { name: "더 보기", exact: true });
    // A refresh retains old rows; measure append requests after it finishes.
    await expect(more).toHaveAttribute("aria-disabled", "false");
    const cursors: string[] = [];
    let fail = false, failed = false;
    await page.route("**/api/entities?**", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) cursors.push(cursor);
      if (fail && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: { code: "unavailable", message: "추가 페이지 일시 실패", retryable: true, fields: [] },
        });
      } else await route.continue();
    });
    await more.scrollIntoViewIfNeeded();
    const main = page.getByRole("main", { includeHidden: true });
    const y = await main.evaluate(element => element.scrollTop);
    expect(y).toBeGreaterThan(0);
    await more.click();
    await expect(page.locator("[data-list-anchor]")).toHaveCount(60);
    await expect(more).toBeFocused();
    expect(cursors).toHaveLength(1);
    expect(new URL(page.url()).searchParams.get("pages")).toBe("3");
    expect(await main.evaluate(element => element.scrollTop)).toBe(y);
    await more.scrollIntoViewIfNeeded();
    const retryY = await main.evaluate(element => element.scrollTop);
    expect(retryY).toBeGreaterThan(0);
    const retryBox = (await more.boundingBox())!;
    fail = true;
    await more.click();
    const retry = page.getByRole("button", { name: "다시 시도", exact: true });
    await expect(retry).toBeFocused();
    await expect(page.locator("[data-list-anchor]")).toHaveCount(60);
    // The notice changes main content height; browser scroll anchoring should keep the button in place.
    await expect(retry).toBeInViewport();
    expect(Math.abs((await retry.boundingBox())!.y - retryBox.y)).toBeLessThan(2);
    await retry.click();
    const done = page.getByRole("button", { name: "모두 불러왔습니다", exact: true });
    await expect(page.locator("[data-list-anchor]")).toHaveCount(62);
    await expect(done).toBeFocused();
    await expect(done).toHaveAttribute("aria-disabled", "true");
    expect(cursors).toHaveLength(3);
    expect(cursors[2]).toBe(cursors[1]);
    expect(cursors[1]).not.toBe(cursors[0]);
    expect(await main.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(retryY - 100);
    await expect(anchor).not.toBeFocused();
  } finally {
    // Cleanup is tied to this exact fixture scope, including failed scenarios.
    await mcp.close();
  }
});

test("#396 material creation and editing explain schema bounds before memo confirmation", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", { label: unique("입력 검증") });
    const change = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "quantity",
        field: { "x-order": 20, type: ["integer", "null"], title: "수량", minimum: 0, maximum: 100 },
        required: false,
      }],
    });
    await analyzeAndApply(mcp, type.id, change.id, change.version);
    await page.goto(fixtureEntityList(type.id));
    await beginTabAction(page, type.label + " 추가");
    const form = page.getByRole("dialog", { name: type.label + " 추가" });
    await form.getByLabel("이름", { exact: false }).fill(unique("경계 자료"));
    for (const [value, message] of [["101", "100 이하여야 합니다"], ["-1", "0 이상이어야 합니다"]]) {
      await form.getByLabel("수량", { exact: true }).fill(value);
      await form.getByRole("button", { name: "저장", exact: true }).click();
      await expect(form).toContainText(message);
      await expect(form.getByLabel("수량", { exact: true })).toBeFocused();
      await expect(executionDialog(page)).toHaveCount(0);
    }
    await form.getByLabel("수량", { exact: true }).fill("0");
    await saveOnce(page, form);
    await expect(form).not.toBeVisible();
    const id = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    expect((await mcp.call("get_entity", { id })).properties.prop_2).toBe(0);
    await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: type.label + " 편집" });
    await edit.getByLabel("수량", { exact: true }).fill("101");
    await edit.getByRole("button", { name: "저장", exact: true }).click();
    await expect(edit).toContainText("100 이하여야 합니다");
    expect((await mcp.call("get_entity", { id })).version).toBe(1);
    await edit.getByLabel("수량", { exact: true }).fill("100");
    await saveOnce(page, edit);
    await expect(edit).not.toBeVisible();
    expect((await mcp.call("get_entity", { id })).properties.prop_2).toBe(100);
  } finally {
    await mcp.close();
  }
});
