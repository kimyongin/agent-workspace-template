import { test, expect } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, task, fixtureType, id, stamp } from "./support/workspace-data.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
const apiOrigin = "http://127.0.0.1:55591";
for (const schedule of ["ordinary-return", "held-return-read", "failed-return-read", "existing-tag-draft"] as const) {
  test(`#670 retained entity: ${schedule}, first new tag draft after other-end relationship mutation`, async ({ page }, info) => {
    const product = entity(1, { prop_1: "P01" }), listing = entity(6, { prop_1: "L01" });
    const navigationTask = { ...task(), title: "테스트 이동", entity_ids: [product.id, listing.id],
      entity_context: [product, listing].map(row => ({ id: row.id, title: row.title, type: fixtureType,
        schema_version: 1, source: "selection" as const, captured_at: stamp })) };
    product.tasks = { count: 1, items: [navigationTask] };
    const state = await installWorkspaceApi(page, apiOrigin, { entities: [product, listing],
      tasks: [navigationTask], records: [], tags: [{ id: id(70), name: "판매중", scope: "entity",
        version: 1, created_at: stamp, updated_at: stamp }] });
    const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: {} };
    await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now()/1000)+3600, user })), user);
    await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
    const definition = { id: id(700), version: 1, archived: false, ends: [
      { type_id: fixtureType.id, label: "판매 상품", cardinality: "many" },
      { type_id: fixtureType.id, label: "판매 항목", cardinality: "many" }] };
    let linked = false;
    const observations: unknown[] = [];
    await page.route("**/api/entity-relation-definitions**", route => route.fulfill({ json:
      new URL(route.request().url()).pathname.endsWith(definition.id) ? definition : { items: [definition], next_cursor: null } }));
    await page.route("**/api/entity-relations/**", async route => {
      const req = route.request(), url = new URL(req.url()), parts = url.pathname.split("/"),
        side = Number(parts[4]), originId = decodeURIComponent(parts[5]);
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        observations.push({ event: "relation-write", path: url.pathname, body });
        expect(originId).toBe(listing.id); expect(body.other_id).toBe(product.id);
        expect(body.expected_version).toBe(1); expect(body.expected_other_version).toBe(1);
        linked = true; product.version++; listing.version++;
        return route.fulfill({ json: { changed: true, definition_id: definition.id, side, origin_id: originId,
          other_id: product.id, endpoint_versions: [{ id: product.id, version: product.version }, { id: listing.id, version: listing.version }] } });
      }
      const candidates = url.pathname.endsWith("/candidates");
      return route.fulfill({ json: { definition, side, origin_id: originId,
        items: candidates ? [product] : linked && originId === listing.id && side === 0 ? [product] : [], next_cursor: null } });
    });
    const prepared: number[] = [];
    await page.route("**/api/records/prepare", route => {
      const body = route.request().postDataJSON();
      if (body.target_id !== product.id) return route.fallback();
      prepared.push(body.expected_version);
      observations.push({ event: "prepare", body, serverVersion: product.version });
      if (body.expected_version !== product.version) return route.fulfill({ status: 409,
        json: { code: "conflict", message: "다른 변경이 저장되어 있습니다. 다시 조회하세요." } });
      return route.fallback();
    });
    await page.route("**/api/tag-connections", route => {
      const body = route.request().postDataJSON();
      observations.push({ event: "tag-write", body, serverVersion: product.version });
      if (body.target_id === product.id && body.expected_version !== product.version) return route.fulfill({ status: 409,
        json: { code: "conflict", message: "다른 변경이 저장되어 있습니다. 다시 조회하세요." } });
      return route.fallback();
    });
    page.on("response", async response => {
      if (response.request().method() === "GET" && new URL(response.url()).pathname === `/api/entities/${encodeURIComponent(product.id)}`) {
        observations.push({ event: "product-get", status: response.status(), data: await response.json().catch(() => null) });
      }
    });
    try {
      await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(product.id)}`));
      await expect(detailDialog(page).getByRole("heading", { name: "P01", exact: true })).toBeVisible();
      if (schedule === "existing-tag-draft") {
        await detailDialog(page).getByRole("button", { name: "태그 연결", exact: true }).click();
        const picker = page.getByRole("dialog", { name: "태그 선택", exact: true });
        await picker.getByRole("option", { name: "판매중", exact: true }).click();
        await picker.getByRole("button", { name: "선택 완료", exact: true }).click();
      }
      // Public task link provides navigation to L01 while retaining the original P01 tab.
      await detailDialog(page).getByRole("link", { name: "테스트 이동 상세", exact: true }).click();
      await detailDialog(page).getByRole("link", { name: "L01 상세", exact: true }).click();
      const section = detailDialog(page).getByLabel("판매 상품 관계", { exact: true });
      await section.getByRole("button", { name: "연결", exact: true }).click();
      await section.getByRole("searchbox", { name: "자료 제목 검색", exact: true }).fill("P01");
      await section.getByRole("button", { name: "P01 연결", exact: true }).click();
      await executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
      await expect.poll(() => product.version).toBe(2);
      await expect(executionDialog(page)).toHaveCount(0);
      const clearFailure = schedule === "failed-return-read" ? state.failRead({ kind: "entities", id: product.id }, { once: false }) : null;
      let releaseRead = () => {};
      const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
      const held = schedule === "held-return-read" ? { release: releaseRead } : null;
      if (held) await page.route(`**/api/entities/${encodeURIComponent(product.id)}`, async route => {
        await readGate;
        return route.fallback();
      });
      try {
        await page.getByRole("tab", { name: "P01", exact: true }).click();
        if (schedule === "existing-tag-draft") {
          await detailDialog(page).getByRole("button", { name: "연결 적용", exact: true }).click();
          await expect(executionDialog(page)).toContainText("다른 변경이 저장되어 있습니다.");
          await expect(executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true })).toBeDisabled();
          expect(prepared).toEqual([1]);
          expect(product.tag_ids).toEqual([]);
          await executionDialog(page).getByRole("button", { name: "취소", exact: true }).click();
          await detailDialog(page).getByRole("button", { name: "연결 취소", exact: true }).click();
        }
        const add = detailDialog(page).getByRole("button", { name: "태그 연결", exact: true });
        await expect(add).toBeVisible();
        if (schedule === "failed-return-read") {
          await expect(detailDialog(page)).toContainText("fixture read failed");
          await expect(add).toBeDisabled();
          clearFailure?.();
          await detailDialog(page).getByRole("button", { name: "다시 시도", exact: true }).click();
        }
        // Deliberately do not await the refresh. If guarded, release the read before admission.
        observations.push({ event: "draft-admission", enabled: await add.isEnabled(), schedule });
        if (held) await expect(add).toBeDisabled();
        else await add.click();
        held?.release();
        if (!(await page.getByRole("dialog", { name: "태그 선택", exact: true }).isVisible())) await add.click();
        const picker = page.getByRole("dialog", { name: "태그 선택", exact: true });
        await picker.getByRole("option", { name: "판매중", exact: true }).click();
        await picker.getByRole("button", { name: "선택 완료", exact: true }).click();
        await detailDialog(page).getByRole("button", { name: "연결 적용", exact: true }).click();
        await expect(executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true })).toBeEnabled();
        expect(prepared).toEqual(schedule === "existing-tag-draft" ? [1, 2] : [2]);
        await executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
        await expect.poll(() => product.tag_ids).toEqual([id(70)]);
        expect(product.version).toBe(3); expect(state.errors).toEqual([]);
      } finally { held?.release(); }
    } finally {
      await info.attach("observations.json", { body: JSON.stringify({ observations, prepared, writes: state.writes, errors: state.errors }, null, 2), contentType: "application/json" });
      await page.screenshot({ path: info.outputPath("retained-entity.png"), fullPage: true });
    }
  });
}
