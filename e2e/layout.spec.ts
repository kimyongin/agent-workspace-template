import { openMainNavigation } from "./ui-actions.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
import { beginTabAction, saveOnce } from "./ui-actions.ts";
// 디자인 가이드의 화면 검수 중 자동으로 확인할 수 있는 항목(docs/design/guide.md "화면 완료 체크리스트").
// 화면 폭별 가로 넘침, 조작 영역 44px, 200% 확대(폭 절반), 키보드만으로 작성·닫기, 대화상자 초점.
import { expect, type Page } from "@playwright/test";

import { test, devLogin, mcpClient, mcpTokenViaConsent, unique , ownedWorkspace, workspacePath} from "./support.ts";

async function readableKind(page: Page, workspace: Awaited<ReturnType<typeof ownedWorkspace>>) {
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const kind = await mcp.call("create_entity_type", { label: unique("레이아웃 자료") });
    await workspace.grantKind(kind.id);
  } finally { await mcp.close(); }
}

const WIDTHS = [320,360,390,639,640,768,1024,1440];

test("사용자 바로가기와 별도로 탐색 메뉴에서 전체 업무 화면에 접근한다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  await readableKind(page, workspace);
  await page.goto(workspacePath(workspace.id, "/entities"));
  const navigation = page.getByRole("navigation",{name:"주 메뉴"});
  await openMainNavigation(page);
  const menu = navigation;
  for (const [path, label] of [["/entities","전체 자료"],["/tasks","할 일"],["/records","기록"]]) {
    const link = menu.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", workspacePath(workspace.id, path));
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
      if (r.width === 0 || r.height === 0 || el.closest('[aria-hidden="true"],[hidden],[inert]')) continue; // 숨은 표면과 폼 제출용 backing control은 조작 대상이 아니다.
      if (el.closest(".markdown")) continue; // 본문 속 링크는 글자 크기를 따른다
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
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
      const minimum = 43.5; // 44px target with subpixel rounding tolerance.
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
  const workspace = await ownedWorkspace(page);
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

    // A saved task produces the record; no general record creation remains.
    const taskId = new URL(taskDetail).pathname.split("/").at(-1)!;
    const completed = await workspace.fetch("POST", `/tasks/${taskId}/complete`, {
      expected_version: 1, body: unique("긴기록"+"나".repeat(40))+"\n"+"b".repeat(150),
    });
    expect(completed.status()).toBe(200);
    const record = (await completed.json()).record;
    await page.goto(workspacePath(workspace.id, `/records/${record.id}`));
    await expect(detailDialog(page).getByRole("heading", {name:"기록",exact:true})).toBeVisible();
    const recordDetail = page.url();


      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/tasks", taskDetail, "/records", recordDetail,"/tags",`/search?q=${encodeURIComponent(longTitle)}&mode=keyword`]) {
        await page.goto(path.startsWith("http") ? path : workspacePath(workspace.id, path));
        const detail=detailDialog(page);
        if(/\/(tasks|records)\/[^/?]+/.test(new URL(path,"http://fixture.invalid").pathname))await expect(detail.locator("[data-slot=\"dialog-title\"]")).toBeVisible();
        else await expect(page.getByRole("heading",{level:1})).toBeVisible();
        await expect.poll(() => layoutProblems(page), { message: `${width}px ${path}` }).toEqual([]);
      }
      await page.goto(workspacePath(workspace.id, "/tasks"));
      await beginTabAction(page,"할 일 추가");
      await expect(page.getByRole("dialog", { name: "할 일 추가" })).toBeVisible();
      await expect.poll(() => layoutProblems(page), { message: `${width}px 작성 대화상자` }).toEqual([]);
      const box = await page.getByRole("dialog", { name: "할 일 추가" }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(901);
      await page.keyboard.press("Escape");
  });

  test("200% 확대(폭 절반)에서 넘침·누름 영역·루트 글자 크기가 유지된다", async ({ page }) => {
    await devLogin(page);
  const workspace = await ownedWorkspace(page);
    // 1280px 화면의 200% 확대는 CSS 폭 640px과 같다. 루트 글자 크기를 줄이지 않는다.
    await page.setViewportSize({ width: 640, height: 400 });
    for (const path of ["/tasks", "/records"]) {
      await page.goto(path.startsWith("http") ? path : workspacePath(workspace.id, path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await layoutProblems(page), path).toEqual([]);
      const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
      expect(parseFloat(rootFont)).toBeGreaterThanOrEqual(16);
    }
  });
});

test("키보드만으로 할 일을 만들고, 미저장 내용이 있으면 닫기 전에 확인한다", async ({ page, isMobile }) => {
  test.skip(isMobile, "키보드 흐름은 데스크톱에서 본다");
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
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

test("보조 글자와 상태 표시의 대비가 검수 목표 이상이다", async ({ page }, info) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const results: { label: string; ratio: number; foreground: string; background: number[]; target: number }[] = [];
  const check = async (node: import("@playwright/test").Locator, label: string, kind: "text" | "boundary" | "focus" = "text", unfocusedShadow = "none") => {
    await expect(node).toBeVisible();
    await expect(node).toBeEnabled();
    const measured = await node.evaluate((element, { kind, unfocusedShadow }) => {
      const boundary = kind === "boundary";
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      // The browser resolves CSS Color 4 (including OKLCH) to sRGB; do not parse CSS numbers as RGB.
      const rgba = (paint: string) => {
        if (!CSS.supports("color", paint)) throw new Error(`Unsupported computed paint: ${paint}`);
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = paint;
        context.fillRect(0, 0, 1, 1);
        const channels = Array.from(context.getImageData(0, 0, 1, 1).data);
        return [...channels.slice(0, 3), channels[3] / 255];
      };
      const blend = (front: number[], back: number[]) => front.slice(0, 3).map((channel, i) => channel * front[3] + back[i] * (1 - front[3])).concat(1);
      const background = (node: Element | null) => {
        const ancestors: Element[] = [];
        for (let current = node; current; current = current.parentElement) ancestors.unshift(current);
        return ancestors.reduce((paint, ancestor) => {
          const style = getComputedStyle(ancestor);
          if (style.backgroundImage !== "none" || Number(style.opacity) !== 1) throw new Error("Contrast probe requires the actual flat, fully opaque surface; inspect layered paint separately");
          return blend(rgba(style.backgroundColor), paint);
        }, [255, 255, 255, 1]);
      };
      const style = getComputedStyle(element);
      const inside = background(element), outside = background(element.parentElement);
      const foreground = boundary ? style.borderTopColor : style.color;
      const painted = blend(rgba(foreground), boundary && style.backgroundClip !== "border-box" ? outside : inside);
      const luminance = (color: number[]) => color.slice(0, 3).map(channel => channel / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const ratio = (a: number[], b: number[]) => {
        const [light, dark] = [luminance(a), luminance(b)].sort((a, b) => b - a);
        return (light + 0.05) / (dark + 0.05);
      };
      if (kind === "focus") {
        // Separate shadow layers/tokens only at top level: commas/spaces inside CSS colors are paint syntax.
        const split = (value: string, comma: boolean) => {
          const parts: string[] = [];
          let depth = 0, token = "";
          for (const character of value) {
            if (character === "(") depth++;
            if (character === ")") depth--;
            if (depth === 0 && (comma ? character === "," : /\s/.test(character))) {
              if (token.trim()) parts.push(token.trim());
              token = "";
            } else token += character;
          }
          if (token.trim()) parts.push(token.trim());
          return parts;
        };
        const previous = new Set(split(unfocusedShadow, true));
        const rings = split(style.boxShadow, true).filter(layer => !previous.has(layer)).flatMap(layer => {
          const tokens = split(layer, false), paint = tokens.find(token => CSS.supports("color", token));
          const lengths = tokens.filter(token => token !== paint && token !== "inset").map(Number.parseFloat);
          // Official ring utilities paint a solid, centered, zero-blur outset spread; do not treat a blurred decorative shadow as its full color.
          return paint && !tokens.includes("inset") && lengths[0] === 0 && lengths[1] === 0 && lengths[2] === 0 && lengths[3] > 0 && rgba(paint)[3] > 0 ? [paint] : [];
        });
        if (!rings.length) throw new Error(`Focused input has no added solid outer ring: ${style.boxShadow}`);
        const ring = rings.reverse().reduce((paint, layer) => blend(rgba(layer), paint), outside);
        return { ratio: ratio(ring, outside), foreground: style.boxShadow, background: outside };
      }
      return { ratio: boundary ? Math.min(ratio(painted, inside), ratio(painted, outside)) : ratio(painted, inside), foreground, background: inside };
    }, { kind, unfocusedShadow });
    const target = kind === "text" ? 4.5 : 3;
    results.push({ label, ...measured, target });
    expect.soft(measured.ratio, `${label}: ${measured.ratio.toFixed(2)}:1 (target ${target}:1)`).toBeGreaterThanOrEqual(target);
  };
  await readableKind(page, workspace);
  await page.goto(workspacePath(workspace.id, "/entities"));
  await check(page.getByRole("heading", { name: "전체 자료", level: 1, exact: true }), "App primary text");
  // Existing public samples render the same official components, including all validation/status states.
  await page.goto("/design-samples/index.html?content=1");
  const buttons = page.getByRole("region", { name: "버튼", exact: true });
  const forms = page.getByRole("region", { name: "폼과 상태", exact: true });
  await check(buttons.getByRole("button", { name: "저장", exact: true }), "Primary button text");
  await check(buttons.getByRole("button", { name: "연결 해제 예시", exact: true }), "Destructive button text");
  await check(forms.getByText("목록에서 알아볼 수 있는 이름을 입력하세요.", { exact: true }), "Field help text");
  await check(forms.getByRole("textbox", { name: "읽기 전용", exact: true }), "Readonly input text");
  // Disabled controls and decorative section dividers are excluded by the guide; enabled input identity is not.
  const input = forms.getByRole("textbox", { name: "상품명 (필수)", exact: true });
  await check(input, "Enabled input boundary", "boundary");
  await forms.screenshot({ path: info.outputPath("contrast-enabled-unfocused.png") });
  const unfocusedShadow = await input.evaluate(element => getComputedStyle(element).boxShadow);
  await input.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await check(input, "Keyboard focus ring", "focus", unfocusedShadow);
  await forms.screenshot({ path: info.outputPath("contrast-keyboard-focused.png") });
  await forms.getByRole("button", { name: "입력 확인", exact: true }).click();
  await check(forms.getByText("상품명을 입력하세요.", { exact: true }), "Validation error text");
  await check(input, "Invalid input boundary", "boundary");
  await forms.screenshot({ path: info.outputPath("contrast-invalid.png") });
  await input.fill("대비 검수 상품");
  await forms.getByRole("button", { name: "입력 확인", exact: true }).click();
  await check(forms.getByRole("status").getByText("입력 조건을 충족합니다.", { exact: true }), "Success status text");
  await forms.screenshot({ path: info.outputPath("contrast-success.png") });
  await info.attach("computed-contrast", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
});
