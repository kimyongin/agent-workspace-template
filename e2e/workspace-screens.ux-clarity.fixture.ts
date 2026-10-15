import { expect, test } from "@playwright/test";
import { fixtures, form, go } from "./support/workspace-screens.ts";
import { entity, fixtureType, id } from "./support/workspace-data.ts";
import { saveOnce } from "./ui-actions.ts";

const marketEntity = (n: number, source: string, label: string) => ({
  ...entity(n, { prop_1: "같은 상품" }),
  source,
  source_label: label,
  external_id: `000Ab-${n}`,
  id: `${source}:${fixtureType.id}:000Ab-${n}`,
});

for (const width of [320, 1440]) {
  test(`empty activity ${width}px: reset all search conditions while retaining the selected view`, async ({ page }) => {
    const state = await fixtures(page);
    state.rows.tasks.length = 0;
    state.rows.records.length = 0;
    await page.setViewportSize({ width, height: 900 });
    for (const [kind, label] of [["tasks", "할 일"], ["records", "기록"]]) {
      await go(
        page,
        `/${kind}?q=없는내용&tag_id=${id(12)}&entity_id=${encodeURIComponent(state.rows.entities[0].id)}&view=cards`,
      );
      await expect(page.getByText(`조건에 맞는 ${label}이 없습니다.`, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "검색 조건 해제", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "검색어", exact: true })).toBeFocused();
      const params = new URL(page.url()).searchParams;
      expect(params.get("view")).toBe("cards");
      for (const key of ["q", "entity_id", "tag_id", "tag_ids"]) expect(params.has(key)).toBe(false);
      await expect(page.getByText(`아직 ${label}이 없습니다.`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "검색 조건 해제", exact: true })).toHaveCount(0);
    }
    expect(state.writes).toHaveLength(0);
  });

  test(
    `relation choices ${width}px: excluded pages explain emptiness and selected rows keep the human identity`,
    async ({ page }, info) => {
      const state = await fixtures(page);
      const first = marketEntity(21, "coupang", "쿠팡"), second = marketEntity(22, "naver", "네이버");
      // The adapter keeps the same rows object; replace its contents, not the storage property.
      state.rows.entities.splice(0, state.rows.entities.length, first, second);
      state.listPages("entities", [[first], [second]]);
      await page.setViewportSize({ width, height: 900 });
      await go(page, "/tasks?create=1");
      const editor = form(page);
      await editor.getByLabel("제목", { exact: false }).fill("상품 확인");
      await editor.getByRole("button", { name: "자료 연결", exact: true }).click();
      await editor.getByRole("searchbox", { name: "자료 제목 검색", exact: true }).fill("상품");
      const results = editor.getByRole("group", { name: "자료 검색 결과", exact: true });
      await results.getByRole("button", { name: "같은 상품 연결", exact: true }).click();
      await expect(results.getByText("현재 결과에 연결할 수 있는 항목이 없습니다.", { exact: true })).toBeVisible();
      const selected = editor.getByRole("list", { name: "선택한 자료", exact: true });
      await expect(selected).toContainText("쿠팡 · 000Ab-21");
      await expect(selected).not.toContainText(first.id);
      await results.getByRole("button", { name: "검색 결과 더 보기", exact: true }).click();
      await results.getByRole("button", { name: "같은 상품 연결", exact: true }).click();
      await expect(results.getByText("연결할 수 있는 결과가 없습니다.", { exact: true })).toBeVisible();
      await expect(selected).toContainText("네이버 · 000Ab-22");
      await selected.getByRole("button", { name: "같은 상품 해제", exact: true }).last().click();
      await expect(results.getByRole("button", { name: "같은 상품 연결", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`relation-choice-${width}.png`), fullPage: true });
      await saveOnce(page, editor, "추가");
      expect(state.writes.find((write) => write.path === "/api/tasks")?.body.entity_ids).toEqual([first.id]);
      expect(state.errors).toEqual([]);
    },
  );

  test(`known relation ${width}px: metadata failure keeps the captured name and unsaved note through retry`, async ({ page }) => {
    const state = await fixtures(page);
    const item = marketEntity(21, "coupang", "쿠팡");
    state.rows.entities.splice(0, state.rows.entities.length, item);
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/entities/${encodeURIComponent(item.id)}`);
    await expect(form(page).getByRole("button", { name: "기록 작성", exact: true })).toBeVisible();
    state.failRead({ kind: "entities", id: item.id });
    await form(page).getByRole("button", { name: "기록 작성", exact: true }).click();
    await form(page).getByLabel("본문", { exact: false }).fill("보존할 기록 초안");
    await expect(form(page).getByRole("alert")).toContainText("선택한 자료 정보를 확인하지 못했습니다");
    const selected = form(page).getByRole("list", { name: "선택한 자료", exact: true });
    await expect(selected).toContainText("같은 상품");
    await expect(selected).not.toContainText(item.id);
    await form(page).getByRole("button", { name: "다시 조회", exact: true }).click();
    await expect(selected).toContainText("쿠팡 · 000Ab-21");
    await expect(form(page).getByLabel("본문", { exact: false })).toHaveValue("보존할 기록 초안");
    expect(state.writes).toHaveLength(0);
  });

  test(
    `recurring task ${width}px: native single choice and time-zone selection preserve a valid monthly plan`,
    async ({ page }, info) => {
      const state = await fixtures(page);
      await page.setViewportSize({ width, height: 900 });
      await go(page, "/tasks?create=1");
      const editor = form(page);
      await editor.getByLabel("제목", { exact: false }).fill("월말 정산");
      await editor.getByRole("radio", { name: "반복", exact: true }).check();
      await editor.getByRole("radio", { name: "매일", exact: true }).press("ArrowRight");
      await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
      await expect(editor.getByRole("radio", { name: "매일", exact: true })).not.toBeChecked();
      await editor.getByRole("radio", { name: "매월", exact: true }).check();
      const dates = editor.getByLabel("날짜", { exact: true });
      await expect(dates).toHaveAttribute("inputmode", "text");
      await dates.fill("0, 32");
      await editor.getByRole("button", { name: "추가", exact: true }).click();
      await expect(editor.locator("[aria-invalid=true]")).toHaveCount(1);
      expect(state.writes).toHaveLength(0);
      await dates.fill("1, 31");
      await editor.getByLabel("시작일", { exact: false }).fill("2028-01-31");
      await editor.getByRole("combobox", { name: "시간대", exact: false }).selectOption("America/New_York");
      await editor.getByRole("radio", { name: "일회성", exact: true }).check();
      await expect(editor.getByLabel("기한", { exact: true })).toBeVisible();
      await editor.getByRole("radio", { name: "반복", exact: true }).check();
      await expect(dates).toHaveValue("1, 31");
      await expect(editor.getByLabel("시간대", { exact: false })).toHaveValue("America/New_York");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`recurring-task-${width}.png`), fullPage: true });
      await saveOnce(page, editor, "추가");
      expect(state.writes.find((write) => write.path === "/api/tasks")?.body).toMatchObject({
        kind: "recurring",
        timezone: "America/New_York",
        recurrence: { freq: "monthly", starts_on: "2028-01-31", month_days: [1, 31] },
      });
    },
  );
}

test("historical relations retain their captured names and original number without exposing composite storage keys", async ({ page }) => {
  const state = await fixtures(page), item = marketEntity(21, "coupang", "쿠팡");
  state.rows.entities.splice(0, state.rows.entities.length, item);
  Object.assign(state.rows.records[0], {
    entity_ids: [item.id],
    entity_context: [{
      id: item.id,
      title: "당시 상품명",
      type: { ...fixtureType, label: "당시 종류" },
      schema_version: 1,
      source: "selection",
      captured_at: "2026-10-15T00:00:00Z",
    }],
  });
  await go(page, `/records/${state.rows.records[0].id}`);
  const linked = form(page).getByRole("region", { name: "연결된 자료 (1개)", exact: true });
  await expect(linked).toContainText("당시 상품명");
  await expect(linked).toContainText("당시 종류 · 번호 000Ab-21");
  await expect(linked).not.toContainText(item.id);
  await expect(linked).not.toContainText("속성 버전");
  expect(state.reads.some((url) => url.includes(`/entities/${encodeURIComponent(item.id)}`))).toBe(false);
  await linked.getByRole("button", { name: "당시 상품명", exact: true }).click();
  await expect(linked).toContainText("쿠팡 · 000Ab-21");
  await expect(linked.getByRole("button", { name: "당시 상품명", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});
