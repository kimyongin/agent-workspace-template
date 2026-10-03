// 디자인 가이드의 화면 검수 중 자동으로 확인할 수 있는 항목(docs/design/guide.md "화면 완료 체크리스트").
// 화면 폭별 가로 넘침, 조작 영역 44px, 200% 확대(폭 절반), 키보드만으로 작성·닫기, 대화상자 초점.
import { expect, type Page, test } from "@playwright/test";
import { devLogin, unique } from "./support.ts";

const WIDTHS = [360, 390, 768, 1024, 1440];

/** 가로 넘침과 44px보다 작은 조작 영역(보이는 버튼·링크·입력)을 찾는다. */
async function layoutProblems(page: Page) {
  return await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      problems.push(`가로 넘침 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    }
    const targets = document.querySelectorAll<HTMLElement>("button, a, input, textarea, select");
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 숨은 요소(닫힌 대화상자 등)
      if (el.closest(".markdown")) continue; // 본문 속 링크는 글자 크기를 따른다
      const inline = el.tagName === "A" && !el.classList.contains("btn") && getComputedStyle(el).display === "inline";
      if (inline) continue; // 문장 속 링크는 가이드상 예외(텍스트 조작)
      if (r.height < 43.5 || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && r.width < 43.5)) {
        problems.push(`작은 조작 영역 ${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return problems;
  });
}

test.describe("화면 폭별 배치", () => {
  test.skip(({ isMobile }) => isMobile, "폭은 테스트 안에서 바꾼다");

  test("목록·상세·작성 대화상자에 가로 넘침과 작은 조작 영역이 없다", async ({ page }) => {
    await devLogin(page);
    // 긴 공백 없는 제목으로 줄바꿈 처리도 함께 본다.
    await page.getByRole("button", { name: "할 일 추가" }).click();
    const dialog = page.getByRole("dialog", { name: "할 일 추가" });
    await dialog.getByLabel("제목").fill(unique("가".repeat(40) + "공백없는긴제목"));
    await dialog.getByLabel("요약").fill("https://example.com/" + "a".repeat(120));
    await dialog.getByRole("button", { name: "추가" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const detail = page.url();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/tasks", detail, "/records"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await layoutProblems(page), `${width}px ${path}`).toEqual([]);
      }
      await page.goto("/tasks");
      await page.getByRole("button", { name: "할 일 추가" }).click();
      await expect(page.getByRole("dialog", { name: "할 일 추가" })).toBeVisible();
      expect(await layoutProblems(page), `${width}px 작성 대화상자`).toEqual([]);
      const box = await page.getByRole("dialog", { name: "할 일 추가" }).boundingBox();
      // 640px 미만은 전체 화면, 이상은 중앙 40rem 이하
      if (width < 640) expect(Math.round(box!.width)).toBe(width);
      else expect(box!.width).toBeLessThanOrEqual(640);
      await page.keyboard.press("Escape");
    }
  });

  test("200% 확대(폭 절반)에서도 기능과 읽기 순서가 유지된다", async ({ page }) => {
    await devLogin(page);
    // 1280px 화면의 200% 확대는 CSS 폭 640px과 같다. 루트 글자 크기를 줄이지 않는다.
    await page.setViewportSize({ width: 640, height: 400 });
    for (const path of ["/tasks", "/records"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await layoutProblems(page), path).toEqual([]);
      const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      expect(rootFont).toBe("16px");
    }
  });
});

test("키보드만으로 할 일을 만들고, 미저장 내용이 있으면 닫기 전에 확인한다", async ({ page, isMobile }) => {
  test.skip(isMobile, "키보드 흐름은 데스크톱에서 본다");
  await devLogin(page);
  const add = page.getByRole("button", { name: "할 일 추가" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  await expect(dialog).toBeVisible();

  // 대화상자 안으로 초점이 들어가고, 뒤 화면 요소로 빠져나가지 않는다.
  // 네이티브 모달은 마지막 요소 다음에 초점을 브라우저 UI로 보낼 수 있다(activeElement가 body). 뒤 화면 요소로는 가면 안 된다.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "browser";
      return el.closest("dialog[open]") ? "dialog" : `outside:${el.tagName}:${(el.textContent || "").trim().slice(0, 20)}`;
    });
    expect(where === "dialog" || where === "browser", where).toBe(true);
  }

  // 미저장 내용이 있을 때 Escape → 확인창, 취소하면 초안이 남는다.
  await dialog.getByLabel("제목").focus();
  await page.keyboard.type("키보드 할 일");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("제목")).toHaveValue("키보드 할 일");

  // 요약을 채우고 Enter(제출)로 저장한다.
  const title = unique("키보드 할 일");
  await dialog.getByLabel("제목").fill(title);
  await dialog.getByLabel("요약").focus();
  await page.keyboard.type("키보드로 만든 할 일");
  await dialog.getByLabel("제목").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
});

test("보조 글자와 상태 표시의 대비가 검수 목표 이상이다", async ({ page }) => {
  await devLogin(page);
  const ratios = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const hex = (name: string) => css.getPropertyValue(name).trim();
    const lum = (h: string) => {
      const n = h.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    return {
      "ink/panel": ratio("--ink", "--panel"),
      "muted-ink/panel": ratio("--muted-ink", "--panel"),
      "muted-ink/background": ratio("--muted-ink", "--background"),
      "accent/panel": ratio("--accent", "--panel"),
      "danger/panel": ratio("--danger", "--panel"),
      "success/panel": ratio("--success", "--panel"),
      "warning/panel": ratio("--warning", "--panel"),
      "accent-ink/accent": ratio("--accent-ink", "--accent"),
      "control-border/input-surface": ratio("--control-border", "--input-surface"),
    };
  });
  for (const [pair, r] of Object.entries(ratios)) {
    // 일반 글자 4.5:1, 입력 경계는 3:1(docs/design/guide.md 접근성)
    const target = pair.startsWith("control-border") ? 3 : 4.5;
    expect(r, `${pair} ${r.toFixed(2)}`).toBeGreaterThanOrEqual(target);
  }
});
