import { businessRows } from "./table-actions.ts";
import { entityKey } from "./support/workspace-data.ts";
import { expect, test } from "@playwright/test";
import { entity, fixtureType, id, record, stamp } from "./support/workspace-data.ts";
import { connectedTarget, fixtures, form, go, targetCases } from "./support/workspace-screens.ts";

for (const kind of ["entity", "task"] as const) {
  for (const deleted of [false, true]) {
    test(
      `#183 ${kind}: 불변 귀속만 한 카드로 표시${deleted ? "·삭제된 대상" : ""}`,
      async ({ page }, info) => {
        const state = await fixtures(page),
          r = state.rows.records[0],
          targetId = kind === "entity" ? entityKey(1) : id(2);
        state.rows.entities.push(entity(5, { prop_1: "다른 연결 엔터티" }));
        Object.assign(r, {
          record_kind: "change",
          task_id: kind === "task" ? targetId : null,
          entity_id: kind === "entity" ? targetId : null,
          occurrence_on: kind === "task" ? "2026-10-04" : null,
          change: {
            event_id: id(30),
            target_kind: kind,
            target_id: targetId,
            target_title: "당시 대상",
            action: deleted ? "delete" : "update",
            source: "http",
            before: null,
            after: null,
            path: null,
          },
        });
        const original = JSON.stringify(r);
        if (deleted) {
          await page.route(
            `**/api/${kind === "entity" ? "entities" : "tasks"}/${encodeURIComponent(targetId)}`,
            (route) => route.fulfill({ json: {
              ...(kind === "entity" ? state.rows.entities[0] : state.rows.tasks[0]), deleted_at: stamp,
            } }),
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await go(page, `/records/${r.id}`);
        const changed = connectedTarget(page, kind);
        await expect(businessRows(changed.getByRole("table"))).toHaveCount(1);
        await expect(connectedTarget(page, kind === "entity" ? "task" : "entity")).toHaveCount(0);
        await expect(form(page).getByRole("heading", { name: /^변경 대상/ })).toHaveCount(0);
        await expect(changed.getByRole("button", { name: "다른 연결 엔터티", exact: true })).toHaveCount(0);
        await changed.getByRole("button", { name: "당시 대상", exact: true }).click();
        if (deleted && kind === "task") {
          await expect(changed.getByText("삭제됨", { exact: true })).toBeVisible();
          await expect(changed.locator("dt", { hasText: /^현재 제목$/ }).locator("../dd")).toHaveText(state.rows.tasks[0].title);
          await expect(changed).toContainText(state.rows.tasks[0].body);
          await expect(changed.locator("dt", { hasText: /^상태$/ }).locator("../dd")).toHaveText("진행 중");
          const original = changed.getByRole("link", { name: "당시 대상 상세", exact: true });
          await expect(original).toHaveAttribute("href", `/tasks/${targetId}`);
          await expect(changed.getByRole("link")).toHaveCount(1);
        } else if (deleted) {
          await expect(changed).toContainText("삭제된 항목입니다.");
          await expect(changed.getByRole("link", { name: "당시 대상 상세", exact: true })).toHaveCount(0);
        } else {await expect(changed.getByRole("button", { name: "당시 대상", exact: true })).toHaveAttribute(
            "aria-expanded",
            "true",
          );}
        if (kind === "task") {
          await expect(changed.locator("dt").filter({hasText:/^회차$/}).first().locator("../dd")).toHaveText("2026-10-04");
          if (!deleted) await expect(changed).toContainText("진행 중");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`record-relations-${kind}-${deleted}.png`) });
        expect(JSON.stringify(r)).toBe(original);
        expect(state.writes).toHaveLength(0);
        expect(state.errors).toEqual([]);
      },
    );
  }
}

for (const [kind, route, n] of targetCases) {
  for (const outcome of ["exists", "deleted", "foreign", "failed"] as const) {
    test(`변경 대상 ${kind}: ${outcome} 현재 조회와 역사 metadata 분리`, async ({ page }) => {
      const state = await fixtures(page), r = state.rows.records[0];
      const routeId = kind === "entity" ? encodeURIComponent(entityKey(n)) : id(n);
      const change = {
        event_id: id(30),
        target_kind: kind,
        target_id: kind === "entity" ? entityKey(n) : id(n),
        target_title: "당시 대상 이름",
        action: outcome === "deleted" ? "delete" : "update",
        source: "mcp",
        before: { title: "수정 전" },
        after: { title: "수정 후" },
        path: `/${route}/${routeId}`,
      };
      Object.assign(r, { record_kind: "change", entity_id: kind === "entity" ? change.target_id : null, task_id: kind === "task" ? change.target_id : null, body: "당시 편집 근거", change });
      const original = JSON.stringify(r);
      let reads = 0, fail = outcome === "failed";
      await page.route(
        `**/api/${route}/${routeId}`,
        (endpoint) => {
          reads++;
          const current = state.rows[route].find((row) => row.id === change.target_id)!;
          if (kind === "entity" && reads === 1 && outcome === "failed") {
            return endpoint.fulfill({ json: current });
          }
          return outcome === "foreign"
            ? endpoint.fulfill({ status: 404, json: { code: "not_found", message: "항목을 찾을 수 없습니다" } })
            : fail
            ? endpoint.fulfill({ status: 503, json: { code: "internal", message: "조회 실패" } })
            : endpoint.fulfill({ json: outcome === "deleted" ? { ...current, deleted_at: stamp } : current });
        },
      );
      await go(page, `/records/${r.id}`);
      const target = connectedTarget(page, kind);
      if (kind === "entity" && outcome === "foreign") {
        await expect(page.getByRole("heading", { name: "이 내용을 읽을 권한이 없습니다.", exact: true })).toBeVisible();
        await expect(form(page)).toHaveCount(0);
        for (const text of [change.target_title, "수정 전", "수정 후", r.body]) {
          await expect(page.getByText(text, { exact: true })).toBeHidden();
        }
        expect(JSON.stringify(r)).toBe(original);
        expect(state.writes).toHaveLength(0);
        expect(state.errors).toEqual([]);
        return;
      }
      await expect(target.getByRole("button", { name: change.target_title, exact: true })).toContainText(change.target_title);
      const link = target.getByRole("button", { name: change.target_title, exact: true });
      if (outcome === "exists") await expect(link).toHaveAttribute("aria-expanded", "false");
      else if (outcome === "failed") {
        await link.click();
        await expect(target).toContainText("현재 항목을 불러오지 못했습니다.");
        await expect(target).not.toContainText("삭제된 항목");
        fail = false;
        await target.getByRole("button", { name: "다시 시도", exact: true }).click();
        await expect(target.getByRole("button", { name: "다시 시도", exact: true })).toHaveCount(0);
        expect(reads).toBeGreaterThanOrEqual(2);
      } else if (outcome === "deleted") {
        await link.click();
        await expect(target).toContainText(kind === "entity" ? "삭제된 항목입니다." : "삭제됨");
        if (kind === "entity") await expect(target.getByRole("link")).toHaveCount(0);
      } else {
        await expect(target).toContainText("조회 불가");
        await link.click();
        await expect(target).toContainText("현재 항목을 조회할 수 없습니다.");
        await expect(target.getByRole("link", { name: change.target_title + " 상세", exact: true })).toHaveCount(0);
      }
      await expect(form(page)).toContainText("당시 대상 이름");
      await expect(form(page)).toContainText("수정 전");
      await expect(form(page)).toContainText("수정 후");
      await expect(form(page)).toContainText("당시 편집 근거");
      await expect(form(page)).toContainText("에이전트");
      expect(JSON.stringify(r)).toBe(original);
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
      if (kind === "task" && outcome === "exists") {
        await page.unroute(`**/api/${route}/${routeId}`);
        await go(page, `/records/${r.id}`);
        const card = connectedTarget(page, kind).getByRole("button", { name: change.target_title, exact: true });
        await card.click();
        await expect(card).toHaveAttribute("aria-expanded", "true");
        await expect(page).toHaveURL(new RegExp(`/records/${r.id}$`));
        expect(state.writes).toHaveLength(0);
      }
    });
  }
}

for (const authorized of [true, false]) {
  test(`현재 자료 귀속 권한 조회 503: 비공개 유지·재조회 후 현재 종류 ${authorized ? "허용" : "거부"}`, async ({ page }) => {
    const state = await fixtures(page), r = state.rows.records[0];
    const tag = state.rows.tags.find(value => value.scope === "record")!;
    const typeId = authorized ? fixtureType.id : id(999);
    const parent = { ...state.rows.entities[0], id: `app:${typeId}:${id(1)}`,
      entity_type_id: typeId, type: { ...fixtureType, id: typeId } };
    Object.assign(r, {
      entity_id: parent.id, task_id: null, record_kind: "change", body: "비공개 기록 본문",
      tag_ids: [tag.id],
      change: { event_id: id(30), target_kind: "entity", target_id: parent.id,
        target_title: "비공개 당시 이름", action: "update", source: "http",
        before: { title: "비공개 수정 전" }, after: { title: "비공개 수정 후" }, path: null },
    });
    const original = JSON.stringify(r);
    let release!: () => void, requested!: () => void, reads = 0, successfulReads = 0;
    let phase: "fail" | "recover" = "fail";
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { requested = resolve; });
    await page.route(`**/api/entities/${encodeURIComponent(parent.id)}`, async endpoint => {
      reads++;
      requested();
      // Authority and related previews share this endpoint: no sibling may authorize the parent yet.
      if (phase === "fail") {
        await held;
        return endpoint.fulfill({ status: 503, json: { code: "internal", message: "권한 조회 실패" } });
      }
      successfulReads++;
      return endpoint.fulfill({ json: parent });
    });
    const concealed = async () => {
      await expect(form(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
      await expect(page.getByRole("textbox")).toHaveCount(0);
      for (const text of [r.body, "비공개 당시 이름", "비공개 수정 전", "비공개 수정 후", tag.name]) {
        await expect(page.getByText(text, { exact: true })).toBeHidden();
      }
    };
    try {
      await go(page, `/records/${r.id}`);
      await started;
      await concealed();
      release();
      await expect(page.getByText("기록을 불러오지 못했습니다.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "이 내용을 읽을 권한이 없습니다.", exact: true })).toHaveCount(0);
      await concealed();
      expect(successfulReads).toBe(0);
      phase = "recover";
      await page.getByRole("button", { name: "조회 다시 시도", exact: true }).click();
      if (authorized) {
        await expect(form(page)).toContainText(r.body);
        await expect(form(page)).toContainText("비공개 당시 이름");
        await expect(form(page)).toContainText("비공개 수정 전");
        await expect(form(page)).toContainText("비공개 수정 후");
        await expect(form(page)).toContainText(tag.name);
      } else {
        await expect(page.getByRole("heading", { name: "이 내용을 읽을 권한이 없습니다.", exact: true })).toBeVisible();
        await concealed();
      }
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(successfulReads).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(r)).toBe(original);
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally { release(); }
  });
}

for (const failure of [401, 403, 500, "network", "other404"] as const) {
  test(`변경 대상 조회 ${failure}: 삭제로 오인하지 않고 GET 재시도`, async ({ page }) => {
    const state = await fixtures(page), r = state.rows.records[0];
    Object.assign(r, {
      record_kind: "change", entity_id: entityKey(1), task_id: null,
      change: {
        event_id: id(30),
        target_kind: "entity",
        target_id: entityKey(1),
        target_title: "당시 이름",
        action: "create",
        source: "http",
        before: null,
        after: { prop1: "당시 이름" },
        path: `/entities/${encodeURIComponent(entityKey(1))}`,
      },
    });
    let reads = 0;
    await page.route(
      `**/api/entities/${encodeURIComponent(entityKey(1))}`,
      (endpoint) => {
        if (++reads === 1) return endpoint.fulfill({ json: state.rows.entities[0] });
        return failure === "network" ? endpoint.abort("connectionreset") : endpoint.fulfill({
          status: failure === "other404" ? 404 : failure,
          json: {
            code: failure === 401 ? "unauthenticated" : failure === 403 ? "forbidden" : "internal",
            message: "조회 실패",
          },
        });
      },
    );
    await go(page, `/records/${r.id}`);
    await connectedTarget(page, "entity").getByRole("button", { name: "당시 이름", exact: true }).click();
    await expect(form(page)).toContainText("현재 항목을 불러오지 못했습니다.");
    await expect(form(page)).not.toContainText("삭제된 항목");
    await expect(connectedTarget(page, "entity").getByRole("button", { name: "다시 시도", exact: true })).toBeEnabled();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("변경 대상 목록은 추가 조회 없이 당시 행동만 표시·늦은 상세 응답은 다음 대상에 반영하지 않는다", async ({ page }) => {
  const state = await fixtures(page), r = state.rows.records[0];
  const historical = {
    event_id: id(30),
    target_kind: "entity" as const,
    target_id: entityKey(1),
    target_title: "첫 대상",
    action: "create" as const,
    source: "http" as const,
    before: null,
    after: { prop1: "첫 대상" },
    path: `/entities/${encodeURIComponent(entityKey(1))}`,
  };
  Object.assign(r, { record_kind: "change", entity_id: entityKey(1), task_id: null, change: historical });
  const second = {
    ...record(32),
    entity_id: entityKey(99), task_id: null,
    record_kind: "change" as const,
    change: {
      ...historical,
      target_id: entityKey(99),
      target_title: "다음 대상",
      path: `/entities/${encodeURIComponent(entityKey(99))}`,
    },
  };
  state.rows.records.push(second);
  state.rows.entities.push(entity(99));
  let reads = 0, release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/entities/${encodeURIComponent(entityKey(1))}`, async (endpoint) => {
    if (++reads <= 2) return endpoint.fulfill({ json: state.rows.entities[0] });
    await held;
    await endpoint.fulfill({ json: state.rows.entities[0] }).catch(() => {});
  });
  let nextReads = 0;
  await page.route(`**/api/entities/${encodeURIComponent(entityKey(99))}`, endpoint => {
    if (++nextReads === 1) return endpoint.fulfill({ json: state.rows.entities.at(-1) });
    return endpoint.fulfill({ status: 404, json: { code: "not_found", message: "항목을 찾을 수 없습니다" } });
  });
  await go(page, "/records");
  await expect(page.getByRole("region", { name: "기록 목록", exact: true })).not.toContainText("첫 대상");
  await page.locator("[data-list-anchor]").first().click();
  await expect(page.getByRole("region", { name: "기록 목록", exact: true })).toContainText("첫 대상");
  expect(reads).toBe(0);
  await expect(page.getByRole("region", { name: "기록 목록", exact: true })).not.toContainText("삭제된 대상");
  await go(page, `/records/${r.id}`);
  await connectedTarget(page, "entity").getByRole("button", { name: "첫 대상", exact: true }).click();
  await expect(connectedTarget(page, "entity").getByRole("status")).toBeVisible();
  await expect.poll(() => reads).toBe(3);
  await go(page, `/records/${second.id}`);
  await expect(connectedTarget(page, "entity")).toContainText("조회 불가");
  release();
  await expect(form(page)).toContainText("다음 대상");
  await expect(connectedTarget(page, "entity").getByRole("button", { name: "다음 대상", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

// Captured event targets cannot introduce a second navigable parent.
for (const outcome of ["exists", "deleted", "foreign", "failed"] as const) {
  test(`기록 대상 이력 ${outcome}: 현재 귀속 이외의 기록은 탐색하지 않는다`, async ({ page }) => {
    const state = await fixtures(page), r = state.rows.records[0];
    Object.assign(r, { record_kind: "change", change: {
      event_id: id(30), target_kind: "record", target_id: id(31), target_title: "당시 기록",
      action: "update", source: "http", before: { body: "수정 전" }, after: { body: "수정 후" }, path: `/records/${id(31)}`,
    } });
    let reads = 0;
    await page.route(`**/api/records/${id(31)}`, route => {
      reads++;
      return route.fulfill({ status: outcome === "exists" ? 200 : outcome === "failed" ? 503 : 404, json: record(31) });
    });
    await go(page, `/records/${r.id}`);
    await expect(connectedTarget(page, "task")).toBeVisible();
    await expect(form(page)).toContainText("당시 기록");
    await expect(form(page)).toContainText("수정 전");
    await expect(form(page)).toContainText("수정 후");
    await expect(form(page).getByRole("button", { name: "당시 기록", exact: true })).toHaveCount(0);
    await expect(form(page).getByRole("link", { name: "당시 기록 상세", exact: true })).toHaveCount(0);
    expect(reads).toBe(0);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}
