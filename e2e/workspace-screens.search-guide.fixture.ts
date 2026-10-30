import { expect, type Page, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";

async function setup(page: Page) {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  return state;
}

async function settle(page: Page) {
  await expect.poll(() =>
    page.evaluate(() =>
      document.getAnimations().filter((animation) =>
        animation.playState === "running" &&
        animation.effect?.getTiming().iterations !== Infinity
      ).length
    )
  ).toBe(0);
}

test(
  "guide headings, list and destination links remain readable at narrow and enlarged widths",
  async ({ page }, info) => {
    const state = await setup(page);
    for (const [width, scale] of [[390, 100], [1440, 100], [320, 200]]) {
      await page.setViewportSize({ width, height: 900 });
      await goApp(page, "/guide");
      await page.evaluate(
        (scale) => document.documentElement.style.fontSize = `${scale}%`,
        scale,
      );
      const guide = page.getByRole("region", {
        name: "사용 가이드",
        exact: true,
      });
      const heading = guide.getByRole("heading", {
        name: "자료 하나 만들기",
        exact: true,
      });
      const metrics = await heading.evaluate((element) => {
        const h = getComputedStyle(element),
          p = getComputedStyle(element.nextElementSibling!);
        return {
          headingSize: parseFloat(h.fontSize),
          bodySize: parseFloat(p.fontSize),
          headingWeight: Number(h.fontWeight),
          bodyWeight: Number(p.fontWeight),
        };
      });
      await settle(page);
      await page.screenshot({
        path: info.outputPath(`guide-${width}-${scale}.png`),
        fullPage: true,
      });
      expect(metrics.headingSize).toBeGreaterThan(metrics.bodySize);
      expect(metrics.headingWeight).toBeGreaterThan(metrics.bodyWeight);
      expect(
        await guide.locator("ul").first().evaluate((element) => getComputedStyle(element).listStyleType),
      ).toBe(
        "disc",
      );
      for (const name of ["자료로 이동", "할 일로 이동", "기록으로 이동"]) {
        await expect(
          guide.getByRole("link", { name, exact: true }),
        ).toBeVisible();
      }
      expect(
        await guide.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth &&
            element.scrollWidth <= element.clientWidth + 1;
        }),
      ).toBe(true);
      for (const link of await guide.getByRole("link").all()) {
        expect(
          await link.evaluate((element) => {
            const guide = element.closest("section")!.getBoundingClientRect(),
              bounds = element.getBoundingClientRect();
            return bounds.left >= guide.left && bounds.right <= guide.right + 1;
          }),
        ).toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "설치·연결 정보", exact: true }).click();
    const address = page.getByRole("textbox", { name: "이 앱의 MCP 연결 주소", exact: true });
    await address.scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({ path: info.outputPath("guide-connection-320-200.png"), fullPage: true });
    expect(
      await page.getByRole("region", { name: "사용 가이드", exact: true }).evaluate((element) =>
        element.scrollWidth <= element.clientWidth + 1
      ),
    ).toBe(true);
    expect((await address.inputValue()).length).toBeGreaterThan(0);
    expect(state.writes).toHaveLength(0);
  },
);

test(
  "guide copy feedback starts without an empty box and announces a successful copy",
  async ({ page }, info) => {
    const state = await setup(page);
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (globalThis as typeof globalThis & { __copiedAddress?: string })
              .__copiedAddress = text;
          },
        },
      })
    );
    await goApp(page, "/guide");
    await page.getByRole("button", { name: "설치·연결 정보", exact: true })
      .click();
    const guide = page.getByRole("region", {
        name: "사용 가이드",
        exact: true,
      }),
      status = guide.getByRole("status");
    await guide.getByRole("textbox").scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({
      path: info.outputPath("copy-before-action.png"),
      fullPage: true,
    });
    const box = await status.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(1);
    await guide.getByRole("button", { name: "연결 주소 복사", exact: true })
      .click();
    await expect(status).toHaveText("연결 주소를 복사했습니다.");
    expect(
      await page.evaluate(() =>
        (globalThis as typeof globalThis & { __copiedAddress?: string })
          .__copiedAddress
      ),
    )
      .toBe(
        await guide.getByRole("textbox", {
          name: "이 앱의 MCP 연결 주소",
          exact: true,
        }).inputValue(),
      );
    await status.scrollIntoViewIfNeeded();
    await settle(page);
    await page.screenshot({
      path: info.outputPath("copy-success.png"),
      fullPage: true,
    });
    expect(state.writes).toHaveLength(0);
  },
);

test("failed guide copy keeps the exact selectable address and offers a useful fallback", async ({ page }) => {
  const state = await setup(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error("fixture denied");
        },
      },
    })
  );
  await goApp(page, "/guide");
  await page.getByRole("button", { name: "설치·연결 정보", exact: true })
    .click();
  await page.getByRole("button", { name: "연결 주소 복사", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "복사하지 못했습니다. 위 주소를 선택해 직접 복사하세요.",
  );
  const address = page.getByRole("textbox", {
    name: "이 앱의 MCP 연결 주소",
    exact: true,
  });
  await address.focus();
  expect(
    await address.evaluate((element) => element.selectionEnd - element.selectionStart),
  ).toBe(
    (await address.inputValue()).length,
  );
  expect(state.writes).toHaveLength(0);
});

test(
  "search clear changes only the text draft and leaves results, URL and filter draft until explicit search",
  async ({ page }, info) => {
    const state = await setup(page), reads: unknown[] = [];
    await page.route("**/api/search", (route) => {
      reads.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          items: [],
          next_cursor: null,
          search_state: "ok",
          semantic_coverage: { pending: 0, excluded: 0, failed: 0 },
        },
      });
    });
    await goApp(page, "/search?q=기존검색&kind=record&mode=keyword&filters=1");
    await expect.poll(() => reads.length).toBe(1);
    await page.getByLabel("검색 대상", { exact: true }).selectOption("task");
    const input = page.getByRole("textbox", { name: "검색어", exact: false }),
      clear = page.getByRole("button", {
        name: "입력한 검색어 지우기",
        exact: true,
      });
    await settle(page);
    await page.screenshot({
      path: info.outputPath("search-before-clear.png"),
      fullPage: true,
    });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    expect(new URL(page.url()).searchParams.get("q")).toBe("기존검색");
    expect(new URL(page.url()).searchParams.get("kind")).toBe("record");
    await expect(page.getByLabel("검색 대상", { exact: true })).toHaveValue(
      "task",
    );
    await expect(
      page.getByText("현재 결과의 검색어: 기존검색", { exact: true }),
    ).toBeVisible();
    expect(reads).toHaveLength(1);
    await input.fill("새검색");
    await input.dispatchEvent("compositionstart");
    await input.press("Enter");
    expect(reads).toHaveLength(1);
    await input.dispatchEvent("compositionend");
    await input.press("Enter");
    await expect.poll(() => reads.length).toBe(2);
    expect(reads[1]).toMatchObject({ query: "새검색", kinds: ["record"] });
    await expect(page.getByLabel("검색 대상", { exact: true })).toHaveValue(
      "task",
    );
    await expect(clear).toBeVisible();
    await clear.click();
    expect(reads).toHaveLength(2);
    expect(state.writes).toHaveLength(0);
  },
);

test(
  "closed search filters describe the applied scope rather than pending edits and never trigger extra reads",
  async ({ page }, info) => {
    const state = await setup(page), reads: unknown[] = [];
    await page.route("**/api/search", (route) => {
      reads.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          items: [],
          next_cursor: null,
          search_state: "ok",
          semantic_coverage: { pending: 0, excluded: 0, failed: 0 },
        },
      });
    });
    const query =
      "q=검사&kind=record&mode=keyword&record_kind=change&from=2026-10-01T00:00&to=2026-10-30T23:59";
    await goApp(page, `/search?${query}`);
    await expect.poll(() => reads.length).toBe(1);
    const summary = page.getByLabel("적용된 필터", { exact: true });
    await settle(page);
    await page.screenshot({
      path: info.outputPath("search-closed-filters.png"),
      fullPage: true,
    });
    await expect(summary).toContainText("대상: 기록");
    await expect(summary).toContainText("키워드");
    await expect(summary).toContainText("변경 기록");
    await expect(summary).toContainText("시작:");
    await expect(summary).toContainText("종료:");
    await page.getByRole("button", { name: "필터 열기 · 적용 중", exact: true })
      .click();
    await page.getByLabel("검색 대상", { exact: true }).selectOption("task");
    await page.getByRole("button", { name: "필터 닫기 · 적용 중", exact: true })
      .click();
    await expect(summary).toContainText("대상: 기록");
    await expect(summary).not.toContainText("대상: 할 일");
    expect(reads).toHaveLength(1);
    expect(new URL(page.url()).searchParams.get("kind")).toBe("record");
    for (const [width, scale] of [[390, 100], [1440, 100], [320, 200]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (scale) => document.documentElement.style.fontSize = `${scale}%`,
        scale,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await settle(page);
      await page.screenshot({
        path: info.outputPath(`search-summary-${width}-${scale}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "필터 열기 · 적용 중", exact: true })
      .click();
    await page.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect.poll(() => reads.length).toBe(2);
    await page.getByRole("button", { name: "필터 닫기 · 적용 중", exact: true })
      .click();
    await expect(summary).toContainText("대상: 할 일");
    const linked = new URLSearchParams({
      q: "검사",
      kind: "task",
      task_kind: "recurring",
      task_status: "active",
      tag_id: "00000000-0000-4000-8000-000000000001",
      entity_id:
        "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    });
    await goApp(page, `/search?${linked}`);
    await expect.poll(() => reads.length).toBe(3);
    await expect(summary).toContainText("할 일 종류: 반복");
    await expect(summary).toContainText("할 일 상태: 반복 중");
    await expect(summary).toContainText("태그: 1개");
    await expect(summary).toContainText("선택한 자료");
    await expect(summary).not.toContainText("00000000");
    await goApp(
      page,
      "/search?q=검사&kind=__proto__&from=invalid&tag_id=invalid",
    );
    await expect(summary).toContainText("확인 필요");
    await expect(summary).not.toContainText("__proto__");
    expect(reads).toHaveLength(3);
    expect(state.writes).toHaveLength(0);
  },
);
