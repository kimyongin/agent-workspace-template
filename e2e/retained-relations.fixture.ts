import { expect, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, fixtureType, id, stamp, task } from "./support/workspace-data.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
const apiOrigin = "http://127.0.0.1:56896";
for (const cardinality of ["one", "many"] as const) {
  test(
    `retained ${cardinality} relation updates both endpoints after connection and unlink`,
    async ({ page }, info) => {
      const mobile = info.project.name === "mobile";
      const product = entity(1, { prop_1: "P01" }), listing = entity(6, { prop_1: "L01" });
      const sources = cardinality === "many" ? [listing, entity(7, { prop_1: "L02" })] : [listing];
      const entities = [product, ...sources];
      const navigationTask = {
        ...task(),
        title: "테스트 이동",
        entity_ids: entities.map((row) => row.id),
        entity_context: entities.map((row) => ({
          id: row.id,
          title: row.title,
          type: fixtureType,
          schema_version: 1,
          source: "selection" as const,
          captured_at: stamp,
        })),
      };
      product.tasks = { count: 1, items: [navigationTask] };
      const state = await installWorkspaceApi(page, apiOrigin, {
        entities,
        tasks: [navigationTask],
        records: [],
        tags: [{ id: id(70), name: "판매중", scope: "entity", version: 1, created_at: stamp, updated_at: stamp }],
      });
      const user = {
        id: id(100),
        aud: "authenticated",
        email: "fixture@example.test",
        app_metadata: {},
        user_metadata: {},
      };
      await page.addInitScript((user) =>
        localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: "fixture",
            refresh_token: "fixture",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user,
          }),
        ), user);
      await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
      const definition = {
        id: id(700),
        version: 1,
        archived: false,
        ends: [
          { type_id: fixtureType.id, label: "판매 상품", cardinality },
          { type_id: fixtureType.id, label: "판매 항목", cardinality },
        ],
      };
      const links = new Set<string>();
      const observations: unknown[] = [];
      await page.route("**/api/entity-relation-definitions**", (route) =>
        route.fulfill({
          json: new URL(route.request().url()).pathname.endsWith(definition.id)
            ? definition
            : { items: [definition], next_cursor: null },
        }));
      await page.route("**/api/entity-relations/**", async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          parts = url.pathname.split("/"),
          side = Number(parts[4]),
          originId = decodeURIComponent(parts[5]);
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          observations.push({ event: "relation-write", path: url.pathname, body });
          const origin = entities.find((row) => row.id === originId)!;
          const other = entities.find((row) => row.id === body.other_id)!;
          expect(body.other_id).toBe(other.id);
          expect(body.expected_version).toBe(origin.version);
          expect(body.expected_other_version).toBe(other.version);
          const source = originId === product.id ? other : origin;
          if (url.pathname.endsWith("/unlink")) links.delete(source.id);
          else links.add(source.id);
          origin.version++;
          other.version++;
          return route.fulfill({
            json: {
              changed: true,
              definition_id: definition.id,
              side,
              origin_id: originId,
              other_id: other.id,
              endpoint_versions: [{ id: origin.id, version: origin.version }, {
                id: other.id,
                version: other.version,
              }],
            },
          });
        }
        const candidates = url.pathname.endsWith("/candidates");
        observations.push({
          event: "relation-read",
          path: url.pathname,
          links: [...links],
          productVersion: product.version,
        });
        return route.fulfill({
          json: {
            definition,
            side,
            origin_id: originId,
            items: candidates
              ? originId === product.id ? sources : [product]
              : originId === product.id && side === 1
              ? sources.filter((row) => links.has(row.id))
              : side === 0 && links.has(originId)
              ? [product]
              : [],
            next_cursor: null,
          },
        });
      });
      let holdReturn = false;
      let releaseRead!: () => void, readStarted!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const started = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      await page.route("**/api/entities/**", async (route) => {
        if (
          !holdReturn || route.request().method() !== "GET" ||
          new URL(route.request().url()).pathname !== `/api/entities/${encodeURIComponent(product.id)}`
        ) return route.fallback();
        readStarted();
        await readGate;
        return route.fulfill({ status: 503, json: { code: "internal", message: "최신 자료 조회 실패" } });
      });
      try {
        await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(product.id)}`));
        await expect(detailDialog(page).getByRole("heading", { name: "P01", exact: true })).toBeVisible();
        await expect(detailDialog(page).getByLabel("판매 항목 관계", { exact: true })).toContainText(
          "연결된 자료가 없습니다",
        );
        if (cardinality === "many" && !mobile) {
          const reverse = detailDialog(page).getByLabel("판매 항목 관계", { exact: true });
          await reverse.getByRole("button", { name: "연결", exact: true }).click();
          await reverse.getByRole("searchbox", { name: "자료 제목 검색", exact: true }).fill("L0");
        }
        // Public task link provides navigation to L01 while retaining the original P01 tab.
        await detailDialog(page).getByRole("link", { name: "테스트 이동 상세", exact: true }).click();
        for (let index = 0; index < sources.length; index++) {
          if (index) {
            if (mobile) {
              await detailDialog(page).getByRole("button", { name: /^이전:/ }).click();
              await detailDialog(page).getByRole("link", { name: "테스트 이동 상세", exact: true }).click();
            } else await page.getByRole("tab", { name: "테스트 이동", exact: true }).click();
          }
          await detailDialog(page).getByRole("link", { name: `${sources[index].title} 상세`, exact: true }).click();
          const section = detailDialog(page).getByLabel("판매 상품 관계", { exact: true });
          await section.getByRole("button", { name: "연결", exact: true }).click();
          await section.getByRole("searchbox", { name: "자료 제목 검색", exact: true }).fill("P01");
          await section.getByRole("button", { name: "P01 연결", exact: true }).click();
          await executionDialog(page).getByRole("button", {
            name: cardinality === "one" ? "수정하고 저장" : "연결하고 저장",
            exact: true,
          }).click();
          await expect.poll(() => product.version).toBe(index + 2);
          await expect(executionDialog(page)).toHaveCount(0);
        }
        if (cardinality === "many" && !mobile) holdReturn = true;
        if (mobile) {
          await detailDialog(page).getByRole("button", { name: /^이전:/ }).click();
        } else {
          const retainedTab = page.getByRole("tab", { name: "P01", exact: true });
          await retainedTab.focus();
          await page.keyboard.press("Enter");
        }
        const reverse = detailDialog(page).getByLabel("판매 항목 관계", { exact: true });
        if (cardinality === "many" && !mobile) {
          await started;
          await expect(reverse.getByRole("status")).toContainText("마지막 조회값입니다. 최신 연결을 불러오는 중");
          await expect(reverse.getByRole("button", { name: "판매 항목 작성해서 연결", exact: true })).toBeDisabled();
          await expect(reverse.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
          await expect(reverse.getByRole("searchbox", { name: "자료 제목 검색", exact: true })).toHaveValue("L0");
          await expect(reverse).not.toContainText("연결된 자료가 없습니다");
          releaseRead();
          await expect(detailDialog(page)).toContainText("최신 자료 조회 실패");
          await expect(reverse.getByRole("status")).toContainText("최신 연결을 확인하지 못했습니다");
          await expect(reverse.getByRole("button", { name: "판매 항목 작성해서 연결", exact: true })).toBeDisabled();
          await expect(reverse.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
          await expect(reverse.getByRole("searchbox", { name: "자료 제목 검색", exact: true })).toHaveValue("L0");
          await reverse.getByRole("button", { name: "닫기", exact: true }).click();
          holdReturn = false;
          await detailDialog(page).getByRole("button", { name: "다시 시도", exact: true }).click();
        }
        await expect(reverse.getByRole(cardinality === "one" ? "link" : "button", { name: "L01", exact: true }))
          .toBeVisible({ timeout: 2500 });
        await reverse.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("current-inverse-relations.png") });
        if (cardinality === "many") await reverse.getByRole("button", { name: "L01", exact: true }).click();
        if (cardinality === "many") {
          await expect(reverse.getByRole("heading", { name: "판매 항목 (2개)", exact: true })).toBeVisible();
        }
        await reverse.getByRole("button", { name: cardinality === "one" ? "해제" : "L01 연결 해제", exact: true })
          .click();
        await executionDialog(page).getByRole("button", { name: "해제하고 저장", exact: true }).click();
        if (cardinality === "one") await expect(reverse).toContainText("연결된 자료가 없습니다");
        else await expect(reverse.getByRole("button", { name: "L02", exact: true })).toBeVisible();
        if (mobile) {
          await detailDialog(page).getByRole("link", { name: "테스트 이동 상세", exact: true }).click();
          await detailDialog(page).getByRole("link", { name: "L01 상세", exact: true }).click();
        } else await page.getByRole("tab", { name: "L01", exact: true }).click();
        await expect(detailDialog(page).getByLabel("판매 상품 관계", { exact: true })).toContainText(
          "연결된 자료가 없습니다",
        );
        expect(product.version).toBe(cardinality === "one" ? 3 : 4);
        expect(listing.version).toBe(3);
        expect(state.errors).toEqual([]);
      } finally {
        releaseRead();
        await info.attach("observations.json", {
          body: JSON.stringify(
            { observations, reads: state.reads, writes: state.writes, errors: state.errors },
            null,
            2,
          ),
          contentType: "application/json",
        });
        await page.screenshot({ path: info.outputPath("retained-entity.png"), fullPage: true });
      }
    },
  );
}
