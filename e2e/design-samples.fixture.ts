import { openDialogs } from "./ui-actions.ts";
import { expect, type Locator, type Page, test } from "@playwright/test";

const detailDialog = (page: Page) => page.getByRole("dialog", { name: "상품 편집", exact: true, includeHidden: true });
const shortDialog = (page: Page) =>
  page.getByRole("alertdialog").or(
    page.getByRole("dialog").filter({ hasNot: page.getByRole("heading", { name: "상품 편집", exact: true }) }),
  );

async function checkTag(option: Locator, checked = true) {
  if (await option.getAttribute("aria-checked") !== String(checked)) await option.click();
  await expect(option).toHaveAttribute("aria-checked", String(checked));
}

test("issuer sample opens flat rows and separates saved issuer from optional first number", async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/design-samples/index.html?screen=issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await expect(page.getByText("주문 번호", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("번호 출처 이름").fill("지마켓");
  await issuer.getByRole("button", { name: "저장하고 번호 추가" }).click();
  const number = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await expect(number.getByRole("status")).toHaveText("번호 출처를 저장했습니다.");
  await page.screenshot({ path: info.outputPath("issuer-first-number.png"), fullPage: true });
  await number.getByRole("button", { name: "나중에 추가" }).click();
  const row = page.getByRole("region", { name: "지마켓", exact: true });
  await expect(row.getByText("등록된 번호 종류가 없습니다.")).toBeVisible();
  await row.getByRole("button", { name: "번호 종류 추가", exact: true }).click();
  await number.getByLabel("번호 종류 이름").fill("상품 번호");
  await number.getByRole("button", { name: "저장", exact: true }).click();
  await expect(row.getByText("상품 번호", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("issuer-sample.png"), fullPage: true });
  expect(writes).toEqual([]);
});

test("number sample edits a kind in place and preserves the draft after cancelled discard", async ({ page }, info) => {
  await page.goto("/design-samples/index.html?screen=issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 번호 편집", exact: true }).click();
  const editor = page.getByRole("form", { name: "번호 종류 편집" });
  await editor.getByLabel("번호 종류 이름").fill("마켓 상품 번호");
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("마켓 상품 번호");
  await page.screenshot({ path: info.outputPath("number-sample-inline.png"), fullPage: true });
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("마켓 상품 번호", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "출처 편집", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
  await modal.getByLabel("번호 출처 이름").fill("쿠팡 마켓");
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "쿠팡 마켓", exact: true })).toBeVisible();
});

test("account settings sample keeps independent drafts and clear row actions", async ({ page }, info) => {
  await page.goto("/design-samples/index.html?screen=settings");
  const section = (name: string) => page.getByRole("region", { name, exact: true });
  const profile = section("프로필");
  const display = section("화면 표시");
  const navigation = section("메뉴 바로가기");
  await profile.getByRole("textbox", { name: "닉네임", exact: true }).fill("남겨 둘 초안");
  await display.getByRole("radiogroup", { name: "모바일 화면 배율", exact: true }).getByRole("radio", {
    name: "125%",
    exact: true,
  }).click();
  await display.getByRole("button", { name: "저장", exact: true }).click();
  await expect(profile.getByRole("textbox")).toHaveValue("남겨 둘 초안");
  await navigation.getByRole("button", { name: "기록 위로 이동", exact: true }).click();
  await expect(navigation.getByRole("list", { name: "선택한 바로가기" }).locator(":scope > li > span")).toHaveText([
    "상품",
    "기록",
    "할 일",
  ]);
  await navigation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(navigation.getByRole("list", { name: "선택한 바로가기" }).locator(":scope > li > span")).toHaveText([
    "상품",
    "할 일",
    "기록",
  ]);
  await navigation.getByRole("button", { name: "상품 숨기기", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "할 일 숨기기", exact: true })).toBeFocused();
  await navigation.getByRole("combobox", { name: "추가할 메뉴", exact: true }).selectOption("products");
  await navigation.getByRole("button", { name: "추가", exact: true }).click();
  await navigation.getByRole("button", { name: "저장", exact: true }).click();
  await expect(navigation.getByRole("list", { name: "선택한 바로가기" }).locator(":scope > li > span")).toHaveText([
    "할 일",
    "기록",
    "상품",
  ]);
  await expect(profile.getByRole("textbox")).toHaveValue("남겨 둘 초안");
  for (const width of [320, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await navigation.getByRole("button", { name: / (위로 이동|아래로 이동|숨기기)$/ }).all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("account-settings.png"), fullPage: true });
});
const direct = "/design-samples/index.html?content=1";

test("authentication-free samples align input actions and handle narrow widths", async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto(direct);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "같은 역할, 같은 문법" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dimensions = await page.locator("#buttons").evaluate((node) => {
      const input = node.querySelector("select")!, action = node.querySelector("button")!;
      return {
        input: input.getBoundingClientRect().height,
        action: action.getBoundingClientRect().height,
        inputRadius: getComputedStyle(input).borderRadius,
        actionRadius: getComputedStyle(action).borderRadius,
      };
    });
    expect(dimensions.action).toBe(dimensions.input);
    expect(dimensions.actionRadius).toBe(dimensions.inputRadius);
  }
  const form = page.locator("#forms");
  await form.getByRole("button", { name: "입력 확인" }).click();
  await expect(form.getByLabel("상품명")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("상품명")).toBeFocused();
  await form.getByLabel("상품명").fill("유리컵");
  await form.getByRole("button", { name: "입력 확인" }).click();
  await expect(form.getByRole("status")).toContainText("입력 조건을 충족");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("review captures a read-only definition; apply and discard preserve later drafts", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace"), history = workspace.getByRole("region", { name: "변경 이력" });
  const item = workspace.getByRole("textbox", { name: "항목 이름" });
  await item.fill("재고 수량 A");
  await workspace.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(history.getByText("재고 수량 A", { exact: true }).first()).toContainText("재고 수량 A");
  await expect(history.locator("input,select,textarea")).toHaveCount(0);
  await item.fill("재고 수량 B");
  await expect(history.getByText("재고 수량 A", { exact: true }).first()).toContainText("재고 수량 A");
  await expect(history.getByText("수량 → 재고 수량 A", { exact: true })).toContainText("수량 → 재고 수량 A");
  await history.getByRole("button", { name: "변경 적용", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "취소", exact: true }).click();
  await expect(item).toHaveValue("재고 수량 B");
  await history.getByRole("button", { name: "변경 적용", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "변경 적용", exact: true }).click();
  await expect(history.getByRole("button", { name: /현재 버전 2/ })).toBeVisible();
  await expect(item).toHaveValue("재고 수량 B");
  await workspace.getByRole("button", { name: "변경 검토", exact: true }).click();
  await history.getByRole("button", { name: "폐기", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "변경안 폐기" }).click();
  await expect(history.getByText("상태 버전 3 · 폐기됨", { exact: true })).toBeVisible();
  await expect(item).toHaveValue("재고 수량 B");
  await workspace.getByRole("button", { name: /입력 항목 미저장/ }).click();
  await expect(workspace.getByRole("button", { name: "변경 검토", exact: true })).toBeHidden();
  await workspace.getByRole("button", { name: /입력 항목 미저장/ }).click();
  await expect(item).toHaveValue("재고 수량 B");
});

for (const outcome of ["success", "failure", "uncertain"]) {
  test(`edit/confirmation cancellation, busy and ${outcome} retain input and memo`, async ({ page }) => {
    await page.goto(direct);
    const samples = page.locator("#dialogs");
    await samples.getByLabel("샘플 저장 결과").selectOption(outcome);
    const opener = samples.getByRole("button", { name: "편집 모달 열기" });
    await opener.click();
    const editor = detailDialog(page);
    let dialog = editor;
    await dialog.getByLabel("상품명").fill("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    dialog = shortDialog(page);
    await expect(openDialogs(page)).toHaveCount(2);
    await expect(editor.getByLabel("상품명")).toHaveValue("머그컵");
    await dialog.getByLabel("기록 메모").fill("초안을 유지합니다");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    dialog = editor;
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "닫기" }).click();
    dialog = shortDialog(page);
    await expect(dialog.getByRole("heading")).toHaveText("변경을 버릴까요?");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    dialog = editor;
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    dialog = shortDialog(page);
    await expect(dialog.getByLabel("기록 메모")).toHaveValue("초안을 유지합니다");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "닫기" })).toBeDisabled();
    if (outcome !== "success") {
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog.getByLabel("기록 메모")).toHaveValue("초안을 유지합니다");
      if (outcome === "uncertain") {
        await expect(dialog.getByLabel("기록 메모")).toBeDisabled();
        await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
        await expect(dialog.getByRole("button", { name: "닫기" })).toBeDisabled();
        await dialog.press("Escape");
        await expect(dialog.getByLabel("기록 메모")).toHaveValue("초안을 유지합니다");
        await expect(dialog.getByRole("button", { name: "결과 확인" })).toBeEnabled();
      }
      await dialog.getByRole("button", { name: outcome === "uncertain" ? "결과 확인" : "저장", exact: true }).click();
    }
    await expect(openDialogs(page)).toHaveCount(0);
    await expect(
      samples.getByLabel("예시 상품 전체 정보").locator("dt").filter({ hasText: /^상품명$/ }).locator("+ dd"),
    ).toHaveText("머그컵");
    await expect(opener).toBeFocused();
    await samples.getByRole("button", { name: "예시 자료 삭제" }).click();
    dialog = shortDialog(page);
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(512);
    await dialog.getByRole("button", { name: "취소", exact: true }).press("Escape");
    await expect(openDialogs(page)).toHaveCount(0);
    await expect(
      samples.getByLabel("예시 상품 전체 정보").locator("dt").filter({ hasText: /^상품명$/ }).locator("+ dd"),
    ).toHaveText("머그컵");
  });
}

test("preview width changes keep the same live draft and dialog", async ({ page }) => {
  await page.goto("/design-samples/");
  const content = page.frameLocator("iframe");
  await page.getByRole("button", { name: "목록과 자료 설정", exact: true }).click();
  await content.getByRole("textbox", { name: "항목 이름" }).fill("폭을 바꿔도 유지");
  await page.getByRole("radio", { name: "모바일", exact: true }).click();
  await expect(content.getByRole("textbox", { name: "항목 이름" })).toHaveValue("폭을 바꿔도 유지");
  await page.getByRole("button", { name: "모달과 확인", exact: true }).click();
  await content.getByRole("button", { name: "편집 모달 열기" }).click();
  await content.getByRole("dialog").getByLabel("상품명").fill("같은 모달");
  await page.getByRole("radio", { name: "데스크톱", exact: true }).click();
  await expect(content.getByRole("dialog", { name: "상품 편집", exact: true }).getByLabel("상품명")).toHaveValue(
    "같은 모달",
  );
  await page.getByRole("radio", { name: "모바일", exact: true }).click();
  await content.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  await content.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
    name: "변경 버리기",
  }).click();
  await page.getByRole("radio", { name: "현재 화면", exact: true }).click();
});

test("invalid closed fields expand and focus; move controls retain the expanded row", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  await workspace.getByRole("button", { name: "상품명 텍스트 · 필수 · 자료 이름", exact: true }).focus();
  await page.keyboard.press("Enter");
  const row = workspace.locator('[data-property-id="prop_1"]');
  await expect(row.getByRole("textbox", { name: "항목 이름" })).toBeFocused();
  const field = workspace.locator("#sample-prop_1-body");
  await field.getByRole("button", { name: "추가 설정", exact: true }).click();
  await field.getByLabel("최대 길이").fill("0");
  await field.getByRole("button", { name: "추가 설정", exact: true }).click();
  await workspace.getByRole("button", { name: "상품명 접기", exact: true }).click();
  await workspace.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(field.getByLabel("최대 길이")).toBeVisible();
  await expect(field.getByLabel("최대 길이")).toHaveAttribute("aria-invalid", "true");
  await expect(field.getByLabel("최대 길이")).toBeFocused();
  await field.getByLabel("최대 길이").fill("80");
  await expect(field.getByLabel("최대 길이")).toBeVisible();
  await workspace.getByRole("button", { name: "상품명 아래로 이동", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "상품명 아래로 이동", exact: true })).toBeDisabled();
  await expect(row.getByLabel("항목 이름")).toHaveValue("상품명");
  await expect(workspace.getByRole("button", { name: "상품명 위로 이동", exact: true })).toBeFocused();
  await workspace.getByRole("button", { name: "상품명 위로 이동", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "상품명 아래로 이동", exact: true })).toBeFocused();
  expect(
    await workspace.locator("[data-property-order] svg").first().evaluate((node) => getComputedStyle(node).width),
  ).toBe("16px");
});

test("confirmation fits its content at the center with a dimmed backdrop", async ({ page }) => {
  await page.goto(direct);
  for (
    const viewport of [
      { width: 320, height: 800 },
      { width: 390, height: 800 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 1440, height: 900 },
      { width: 390, height: 260 },
    ]
  ) {
    await page.setViewportSize(viewport);
    await page.locator("#dialogs").getByRole("button", { name: "예시 자료 삭제", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    const geometry = await dialog.boundingBox();
    expect(geometry).not.toBeNull();
    expect(geometry!.height).toBeLessThanOrEqual(viewport.height - 8);
    expect(Math.abs(geometry!.y + geometry!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry!.x + geometry!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toBeVisible();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator("#dialogs").getByRole("button", { name: "편집 모달 열기" }).click();
  const dialog = page.getByRole("dialog");
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(792);
  await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = shortDialog(page);
  expect((await confirmation.boundingBox())!.height).toBeLessThanOrEqual(792);
  await expect(confirmation.getByRole("button", { name: "저장", exact: true })).toBeInViewport({ ratio: 1 });
});

test("history expansion preserves the same section surface as other settings", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  const input = workspace.getByRole("region", { name: "입력 항목", exact: true });
  const history = workspace.getByRole("region", { name: "변경 이력", exact: true });
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const sections = await workspace.locator(":scope > section").evaluateAll((elements) =>
      elements.map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      })
    );
    for (let index = 1; index < sections.length; index++) {
      expect(sections[index].top - sections[index - 1].bottom, `section gap at ${width}px`).toBeGreaterThanOrEqual(16);
    }
    const reference = await input.evaluate((node) => {
      const css = getComputedStyle(node.querySelector('[data-slot="card"]') ?? node);
      return { padding: css.padding, border: css.borderWidth, background: css.backgroundColor };
    });
    for (const open of [true, false]) {
      await history.getByRole("button", { name: /변경 이력 현재 버전/ }).click();
      await expect(history.getByRole("button", { name: /변경 이력 현재 버전/ })).toHaveAttribute(
        "aria-expanded",
        String(open),
      );
      expect(
        await history.evaluate((node) => {
          const css = getComputedStyle(node.querySelector('[data-slot="card"]') ?? node);
          return { padding: css.padding, border: css.borderWidth, background: css.backgroundColor };
        }),
        `history surface at ${width}px, expanded=${open}`,
      ).toEqual(reference);
    }
  }
});

test("tag modal searches and retains draft selections on Escape with focus restoration", async ({ page }, info) => {
  await page.goto(direct);
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const opener = tags.getByRole("button", { name: "태그 선택", exact: true });
  await expect(tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }))
    .toHaveCount(0);
  await opener.click();
  const modal = page.getByRole("dialog", { name: "기본 기록 태그 선택", exact: true });
  await expect(modal.getByRole("combobox", { name: "태그 이름 검색" })).toBeFocused();
  await checkTag(modal.getByRole("option", { name: "중요", exact: true }));
  await modal.getByRole("combobox").fill("진행");
  await expect(modal.getByRole("option")).toHaveCount(1);
  await checkTag(modal.getByRole("option", { name: "진행 중", exact: true }));
  await expect(modal.getByText("2개 선택", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("tag-modal-open.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "진행 중 선택 해제", exact: true })).toBeVisible();
  await tags.getByRole("button", { name: "중요 선택 해제", exact: true }).click();
  await expect(opener).toBeFocused();
  await tags.getByRole("button", { name: "모든 태그 선택 해제" }).click();
  await expect(opener).toBeFocused();
  await expect(tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }))
    .toHaveCount(0);
});

test("tag modal preserves unknown and excluded selections and supports single replacement and limits", async ({ page }) => {
  await page.goto(direct);
  const mode = page.getByLabel("태그 예시 상태");
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const opener = tags.getByRole("button", { name: "태그 선택", exact: true });
  const modal = page.getByRole("dialog", { name: "기본 기록 태그 선택", exact: true });
  for (const state of ["loading", "failure", "unknown", "excluded"]) {
    await mode.selectOption(state);
    await expect(tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }))
      .toHaveCount(1);
    await tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }).click();
    await expect(tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }))
      .toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await mode.selectOption("excluded");
  await opener.click();
  await expect(modal.getByRole("option", { name: "중요", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toBeVisible();
  await mode.selectOption("busy");
  await expect(opener).toBeDisabled();
  await expect(tags.getByRole("button", { name: "모든 태그 선택 해제" })).toBeDisabled();
  await mode.selectOption("single");
  await opener.click();
  await checkTag(modal.getByRole("option", { name: "중요", exact: true }));
  await checkTag(modal.getByRole("option", { name: "진행 중", exact: true }));
  await expect(modal.getByRole("option", { name: "중요", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(modal.getByText("1개 선택", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "선택 완료", exact: true }).click();
  await mode.selectOption("many");
  await opener.click();
  const choices = modal.getByRole("option");
  for (let i = 0; i < 10; i++) await checkTag(choices.nth(i));
  await expect(choices.nth(10)).toBeDisabled();
  await expect(modal).toContainText("최대 10개");
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = (await modal.boundingBox())!;
    expect(
      box.x,
      JSON.stringify({
        width,
        box,
        styles: await modal.evaluate((el) => ({
          maxWidth: getComputedStyle(el).maxWidth,
          width: getComputedStyle(el).width,
          left: getComputedStyle(el).left,
          translate: getComputedStyle(el).translate,
          classes: el.className,
        })),
      }),
    ).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    expect((await modal.getByRole("button", { name: "선택 완료" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(modal.getByRole("button", { name: "선택 완료" })).toBeInViewport({ ratio: 1 });
  await checkTag(choices.first(), false);
  await expect(choices.nth(10)).toBeEnabled();
  await page.evaluate(() => document.documentElement.style.zoom = "");
  await page.setViewportSize({ width: 320, height: 260 });
  await expect(modal.getByRole("combobox", { name: "태그 이름 검색" })).toBeInViewport({ ratio: 1 });
  await choices.first().scrollIntoViewIfNeeded();
  await expect(choices.first()).toBeInViewport({ ratio: 1 });
  await expect(modal.getByRole("button", { name: "선택 완료", exact: true })).toBeInViewport({ ratio: 1 });
  await modal.getByRole("button", { name: "선택 완료", exact: true }).click();
});

test("property choices and official disclosures share production touch targets", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  const row = workspace.locator('[data-property-id="prop_2"]');
  const disclosure = row.getByRole("button", { name: /펼치기$/ });
  if (await disclosure.count()) await disclosure.click();
  const summary = row.getByRole("button", { name: "추가 설정", exact: true });
  await summary.click();
  const input = row.getByRole("checkbox", { name: "필수 입력", exact: true });
  const label = input.locator("..");
  await expect(label).toBeVisible();
  expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const before = await input.isChecked();
  await label.click();
  await expect(input).toBeChecked({ checked: !before });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(label).toBeHidden();
  await page.keyboard.press("Space");
  await expect(label).toBeVisible();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
});

test("single-choice and record-action samples preserve keyboard meaning and hidden drafts", async ({ page }) => {
  await page.goto(direct);
  const form = page.locator("#forms");
  await form.getByRole("radio", { name: "매일", exact: true }).press("ArrowRight");
  await expect(form.getByRole("radio", { name: "매주", exact: true })).toBeFocused();
  await form.getByRole("radio", { name: "매주", exact: true }).press("Space");
  await expect(form.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
  await form.getByRole("combobox", { name: "시간대", exact: true }).selectOption("UTC");
  const settings = page.locator("#record-actions");
  await settings.getByLabel("메모 템플릿", { exact: true }).fill("$없는변수$");
  await settings.getByLabel("액션", { exact: true }).selectOption("delete");
  await settings.getByRole("button", { name: "오류 항목 보기", exact: true }).click();
  await expect(settings.getByLabel("액션", { exact: true })).toHaveValue("create");
  await settings.getByLabel("메모 템플릿", { exact: true }).fill("등록 문구");
  await settings.getByLabel("액션", { exact: true }).selectOption("delete");
  await settings.getByLabel("메모 템플릿", { exact: true }).fill("삭제 문구");
  await expect(settings.getByLabel("저장할 변경", { exact: true })).toHaveText("변경: 등록 · 삭제");
  await settings.getByRole("button", { name: "취소", exact: true }).click();
  await expect(settings.getByLabel("저장할 변경", { exact: true })).toHaveCount(0);
  await expect(settings.getByLabel("메모 템플릿", { exact: true })).toHaveText("대상 액션");
});

test("filter sample keeps drafts until common apply and reuses the tag modal", async ({ page }, info) => {
  await page.goto("/design-samples/index.html?screen=filters");
  const list = page.getByRole("region", { name: "적용된 조건의 자료 목록", exact: true });
  await expect(list.getByRole("heading")).toHaveText("자료 · 3개");
  const apply = page.getByRole("button", { name: "필터 적용", exact: true });
  await apply.click();
  await expect(list.getByRole("heading")).toHaveText("자료 · 1개");
  await expect(list).toContainText("월간 업무 보고서");
  await page.getByLabel("조건 1 값", { exact: true }).fill("프로젝트");
  await page.getByRole("button", { name: "조건 2 제거", exact: true }).click();
  await expect(list).toContainText("월간 업무 보고서");
  await apply.click();
  await expect(list).toContainText("프로젝트 정리");
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await expect(list.getByRole("heading")).toHaveText("자료 · 1개");
  await apply.click();
  await expect(list.getByRole("heading")).toHaveText("자료 · 3개");
  await page.getByRole("button", { name: "태그 선택", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "자료 태그 선택", exact: true });
  await checkTag(chooser.getByRole("option", { name: "프로젝트", exact: true }));
  await chooser.getByRole("button", { name: "선택 완료", exact: true }).click();
  await expect(list.getByRole("heading")).toHaveText("자료 · 3개");
  await apply.click();
  await expect(list).toContainText("프로젝트 정리");
  await expect(list.getByRole("heading")).toHaveText("자료 · 1개");
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await apply.click();
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.getByRole("button", { name: /^조건 [12] 제거$/ }).all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if (width === 390 || width === 1440) {
      await page.screenshot({ path: info.outputPath(`filter-sample-${width}.png`), fullPage: true });
    }
  }
});

test("successful tag refresh invalidates a formerly known selection and empty dictionaries guide management", async ({ page }) => {
  await page.goto(direct);
  const mode = page.getByLabel("태그 예시 상태");
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const opener = tags.getByRole("button", { name: "태그 선택", exact: true });
  const modal = page.getByRole("dialog", { name: "기본 기록 태그 선택", exact: true });
  await opener.click();
  await checkTag(modal.getByRole("option", { name: "중요", exact: true }));
  await modal.getByRole("button", { name: "선택 완료", exact: true }).click();
  await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toBeVisible();
  for (const state of ["loading", "failure"]) {
    await mode.selectOption(state);
    await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toBeVisible();
  }
  await mode.selectOption("unknown");
  await expect(tags.getByText("태그 확인 필요", { exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toHaveCount(0);
  await tags.getByRole("button", { name: "이름 확인이 필요한 태그 1 선택 해제", exact: true }).click();
  await expect(tags.getByRole("button", { name: /^(?!모든 태그).+ 선택 해제$/ }).filter({ hasNotText: "모두 해제" }))
    .toHaveCount(0);
  await mode.selectOption("empty");
  await opener.click();
  await expect(modal.getByText("태그 관리에서 태그를 먼저 추가하세요.", { exact: true })).toBeVisible();
  await modal.getByRole("combobox", { name: "태그 이름 검색" }).fill("없는 이름");
  await expect(modal.getByText("일치하는 태그가 없습니다.", { exact: true })).toBeVisible();
});

test(
  "filter tag headings remain readable at320px with enlarged text before and after selection",
  async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/design-samples/index.html?screen=filters");
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const tags = page.getByRole("group", { name: "자료 태그", exact: true });
    const opener = tags.getByRole("button", { name: "태그 선택", exact: true });
    const clear = tags.getByRole("button", { name: "모든 태그 선택 해제", exact: true });
    for (const selected of [false, true]) {
      if (selected) {
        await opener.click();
        const chooser = page.getByRole("dialog", { name: "자료 태그 선택", exact: true });
        await checkTag(chooser.getByRole("option", { name: "보고서", exact: true }));
        await chooser.getByRole("button", { name: "선택 완료", exact: true }).click();
        await expect(tags.getByRole("button", { name: "보고서 선택 해제", exact: true })).toBeVisible();
      }
      const label = tags.getByText("자료 태그", { exact: true });
      const labelSize = await label.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(labelSize.height).toBeLessThanOrEqual(labelSize.lineHeight + 1);
      await expect(clear).toHaveCount(selected ? 1 : 0);
      const bounds = (await tags.boundingBox())!;
      for (const control of selected ? [opener, clear] : [opener]) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      }
      expect(await tags.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await tags.screenshot({
        path: info.outputPath(`filter-tags-320-text200-${selected ? "selected" : "empty"}.png`),
      });
    }
  },
);

test("보기와 편집은 전체 정보를 유지하고 태그 연결은 상품 편집 취소와 독립적이다", async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto(direct);
  const view = page.locator("#dialogs");
  await expect(view.locator("dl[aria-label='예시 상품 전체 정보'] dt")).toHaveText([
    "상품명",
    "자료 번호",
    "수량",
    "판매 중",
    "메모",
    "태그",
  ]);
  await view.getByRole("button", { name: "태그 연결", exact: true }).click();
  await view.getByRole("button", { name: "태그 선택", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "자료 태그 선택", exact: true });
  await checkTag(chooser.getByRole("option", { name: "중요", exact: true }));
  await chooser.getByRole("button", { name: "선택 완료", exact: true }).click();
  await view.getByRole("button", { name: "연결 적용", exact: true }).click();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await view.scrollIntoViewIfNeeded();
    await view.screenshot({ path: info.outputPath(`sample-view-pairs-${width}.png`) });
    await view.getByRole("button", { name: "편집 모달 열기", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "상품 편집", exact: true });
    await expect(editor.getByLabel("상품명", { exact: false })).toHaveValue("유리컵");
    await expect(editor.getByLabel("수량", { exact: true })).toHaveValue("0");
    await expect(editor.getByLabel("판매 중", { exact: true })).toHaveValue("false");
    await expect(editor.getByLabel("메모", { exact: true })).toContainText("같은 전체 정보");
    await expect(editor.getByText("SAMPLE-001", { exact: true })).toBeVisible();
    await expect(editor.getByText("중요", { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: /태그/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`sample-edit-pairs-${width}.png`) });
    await editor.getByLabel("상품명", { exact: false }).fill("저장하지 않을 변경");
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
      name: "변경 버리기",
      exact: true,
    }).click();
    await expect(view.getByText("중요", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/design-samples/index.html");
  await page.getByRole("radio", { name: "모바일", exact: true }).click();
  const frame = page.frameLocator("iframe");
  await frame.locator("#dialogs").getByRole("button", { name: "편집 모달 열기", exact: true }).click();
  await expect(frame.getByRole("dialog", { name: "상품 편집", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("sample-narrow-preview.png") });
  await frame.locator("html").evaluate((el) => (el as HTMLElement).style.fontSize = "200%");
  await page.screenshot({ path: info.outputPath("sample-narrow-preview-text200.png") });
  expect(writes).toEqual([]);
});

test("confirmation stays usable with reduced motion and enlarged text", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(direct);
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await page.locator("#dialogs").getByRole("button", { name: "예시 자료 삭제", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toHaveCSS("animation-name", "none");
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
  await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "예시 자료 삭제", exact: true })).toBeInViewport({ ratio: 1 });
  for (const label of ["취소", "예시 자료 삭제"]) {
    const button = (await dialog.getByRole("button", { name: label, exact: true }).boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(bounds.x);
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5);
    expect(button.y).toBeGreaterThanOrEqual(bounds.y);
    expect(button.y + button.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5);
  }
  await page.screenshot({ path: info.outputPath("confirmation-320-text200-reduced-motion.png") });
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});


test("short modal motion preserves focus, cancellation and the editor draft", async ({ page }) => {
  await page.goto(direct);
  const trigger = page.locator("#dialogs").getByRole("button", { name: "편집 모달 열기", exact: true });
  await trigger.click();
  const editor = detailDialog(page);
  await expect(editor).toHaveCSS("animation-duration", "0.06s");
  const input = editor.getByLabel("상품명", { exact: false });
  await expect(input).toBeFocused();
  await input.fill("짧은 motion에도 보존할 초안");
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(confirmation).toHaveCSS("animation-duration", "0.06s");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(input).toHaveValue("짧은 motion에도 보존할 초안");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  await confirmation.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(trigger).toBeFocused();
});
