import { openMainNavigation } from "./ui-actions.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
import { beginTabAction, saveOnce } from "./ui-actions.ts";
// 디자인 가이드의 화면 검수 중 자동으로 확인할 수 있는 항목(docs/design/guide.md "화면 완료 체크리스트").
// 화면 폭별 가로 넘침, 조작 영역 44px, 200% 확대(폭 절반), 키보드만으로 작성·닫기, 대화상자 초점.
import { expect, type Page } from "@playwright/test";

import { test, devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

const WIDTHS = [320,360,390,639,640,768,1024,1440];

test("사용자 바로가기와 별도로 탐색 메뉴에서 전체 업무 화면에 접근한다",async({page})=>{
  await devLogin(page);await page.goto("/entities");
  const navigation = page.getByRole("navigation",{name:"주 메뉴"});
  await openMainNavigation(page);
  const menu = navigation;
  for (const [path, label] of [["/entities","전체 자료"],["/tasks","할 일"],["/records","기록"]]) {
    const link = menu.locator(`a[href="${path}"]`);
    await expect(link).toHaveAccessibleName(label);
    await expect(link).toBeVisible();
  }
});

/** 가로 넘침과 44px보다 작은 조작 영역(보이는 버튼·링크·입력)을 찾는다. */
async function layoutProblems(page: Page) {
  return await page.evaluate(() => {
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      problems.push(`가로 넘침 ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    }
    const targets = document.querySelectorAll<HTMLElement>("button, a, input, textarea, select");
    for (const el of targets) {
      let r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 숨은 요소(닫힌 대화상자 등)
      if (el.closest(".markdown")) continue; // 본문 속 링크는 글자 크기를 따른다
      const inline = el.tagName === "A" && !el.classList.contains("btn") && getComputedStyle(el).display === "inline";
      if (inline) continue; // 문장 속 링크는 가이드상 예외(텍스트 조작)
      // Native checkbox/radio glyphs use their associated label as the real pointer target.
      if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) || el instanceof HTMLButtonElement && ["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? "")) {
        const label = [...(el.labels ?? [])].find(label => {
          const box = label.getBoundingClientRect();
          return box.width >= r.width && box.height >= r.height && box.left <= r.left && box.right >= r.right
            && box.top <= r.top && box.bottom >= r.bottom;
        });
        if (label) r = label.getBoundingClientRect();
      }
      // The documented contiguous view selector uses 24px minimum only with a fine pointer.
      const minimum=matchMedia("(pointer: fine)").matches&&el.matches(".view-picker button, .collection-expand-toggle")?24:43.5;
      if (r.height < minimum || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && r.width < minimum)) {
        problems.push(`작은 조작 영역 ${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return problems;
  });
}

test.describe("화면 폭별 배치", () => {
  test.skip(({ isMobile }) => isMobile, "폭은 테스트 안에서 바꾼다");

  for(const width of WIDTHS) test(`${width}px 목록·상세·작성 대화상자에 가로 넘침과 작은 조작 영역이 없다`, async ({ page }) => {
    await devLogin(page);
    // 긴 공백 없는 제목으로 줄바꿈 처리도 함께 본다.
    await beginTabAction(page,"할 일 추가");
    const dialog = page.getByRole("dialog", { name: "할 일 추가" });
    const longTitle = unique("가".repeat(40) + "공백없는긴제목");
    await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(longTitle);
    await dialog.getByLabel("본문").fill("https://example.com/" + "a".repeat(120));
    await saveOnce(page, dialog, "추가");
    // 목록의 h1이 아니라 만든 할 일의 상세 화면이 뜰 때까지 기다린다(모달 뒤 목록 h1도 보이는 것으로 판정됨).
    await expect(detailDialog(page).getByRole("heading", { name: longTitle, exact: true })).toBeVisible();
    const taskDetail = page.url();

    // 기록 상세도 함께 본다.
    await page.goto("/records");
    await beginTabAction(page,"기록 작성");
    const recordDialog = page.getByRole("dialog", { name: "기록 작성" });
    const recordTitle = unique("긴기록" + "나".repeat(40));
    await recordDialog.getByLabel("본문").fill(recordTitle+"\n"+"b".repeat(150));
    await recordDialog.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/records\/[^/?]+/);
    await expect(page.locator('[role="dialog"] [data-slot="dialog-title"]')).toHaveText("기록");
    const recordDetail = page.url();


      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/tasks", taskDetail, "/records", recordDetail,"/tags",`/search?q=${encodeURIComponent(longTitle)}&mode=keyword`]) {
        await page.goto(path);
        const detail=detailDialog(page);
        if(/\/(tasks|records)\/[^/?]+/.test(new URL(path,"http://fixture.invalid").pathname))await expect(detail.locator("[data-slot=\"dialog-title\"]")).toBeVisible();
        else await expect(page.getByRole("heading",{level:1})).toBeVisible();
        expect(await layoutProblems(page), `${width}px ${path}`).toEqual([]);
      }
      await page.goto("/tasks");
      await beginTabAction(page,"할 일 추가");
      await expect(page.getByRole("dialog", { name: "할 일 추가" })).toBeVisible();
      expect(await layoutProblems(page), `${width}px 작성 대화상자`).toEqual([]);
      const box = await page.getByRole("dialog", { name: "할 일 추가" }).boundingBox();
      // 640px 미만은 전체 화면, 이상은 중앙 40rem 이하
      if (width < 640) expect(Math.round(box!.width)).toBe(width);
      else expect(box!.width).toBeLessThanOrEqual(672);
      await page.keyboard.press("Escape");
  });

  test("200% 확대(폭 절반)에서 넘침·누름 영역·루트 글자 크기가 유지된다", async ({ page }) => {
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
  const add = page.getByRole("button", { name: "할 일 등록" });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  await expect(dialog).toBeVisible();
  // 열리면 초점이 대화상자 안에 있다.
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'))).toBe(true);

  // 대화상자 안으로 초점이 들어가고, 뒤 화면 요소로 빠져나가지 않는다.
  // 네이티브 모달은 마지막 요소 다음에 초점을 브라우저 UI로 보낼 수 있다(activeElement가 body). 뒤 화면 요소로는 가면 안 된다.
  let inDialog = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "browser";
      return el.closest('[role="dialog"], [role="alertdialog"]') ? "dialog" : `outside:${el.tagName}:${(el.textContent || "").trim().slice(0, 20)}`;
    });
    expect(where === "dialog" || where === "browser", where).toBe(true);
    if (where === "dialog") inDialog++;
  }
  // 대부분의 Tab은 대화상자 안의 조작 요소에 머문다(브라우저 UI로 나가는 것은 한 바퀴에 한 번 정도).
  expect(inDialog).toBeGreaterThan(15);

  // 미저장 내용이 있을 때 Escape → 확인창, 취소하면 초안이 남는다.
  await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).focus();
  await page.keyboard.type("키보드 할 일");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("키보드 할 일");

  // 제목 칸의 Enter로 확인 단계를 열고 최종 확인 후 저장한다.
  const title = unique("키보드 할 일");
  await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(title);
  await dialog.getByLabel("본문").fill("키보드로 만든 할 일");
  await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).focus();await page.keyboard.press("Enter");
  await executionDialog(page).getByRole("button",{name:"등록하고 저장",exact:true}).click();
  await expect(detailDialog(page).getByRole("heading", { name: title, exact: true })).toBeVisible();

});

test("보조 글자와 상태 표시의 대비가 검수 목표 이상이다", async ({ page }) => {
  await devLogin(page);
  const ratios = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const color = (name: string): number[] => {
      const value = css.getPropertyValue(name).trim();
      return value.startsWith("#") ? [0, 2, 4].map(i => parseInt(value.slice(i + 1, i + 3), 16)).concat(1)
        : [...value.matchAll(/[\d.]+/g)].map(match => Number(match[0]));
    };
    const blend = (front: number[], back: number[]) => front.slice(0, 3).map((channel, i) => channel * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1))).concat(1);
    // Both gradient accents at their strongest gives a conservative backdrop
    // for transparent surfaces, rather than treating rgba text as hex.
    const backdrop = blend([38, 198, 218, 0.1], blend([255, 138, 0, 0.14], color("--background")));
    const panel = blend(color("--panel"), backdrop);
    const resolved = (name: string) => name === "--background" ? backdrop : name === "--panel" ? panel : name === "--input-surface" ? blend(color(name), panel) : color(name);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.slice(0, 3).map(channel => channel / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(resolved(a)), lum(resolved(b))].sort((p, q) => q - p);
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
