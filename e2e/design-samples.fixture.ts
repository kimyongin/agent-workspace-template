import { expect, test } from "@playwright/test";

test("issuer sample opens flat rows and separates saved issuer from optional first number", async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/design-samples/index.html?screen=issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await expect(page.getByText("주문 번호", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "발급처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "발급처 추가", exact: true });
  await issuer.getByLabel("발급처 이름").fill("지마켓");
  await issuer.getByRole("button", { name: "저장하고 번호 추가" }).click();
  const number = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await expect(number.getByRole("status")).toHaveText("발급처를 저장했습니다.");
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

test("account settings sample keeps independent drafts and clear row actions", async ({ page }, info) => {
  await page.goto("/design-samples/index.html?screen=settings");
  const section = (name: string) => page.getByRole("region", { name, exact: true });
  const profile = section("프로필");
  const display = section("화면 표시");
  const navigation = section("메뉴 바로가기");
  await profile.getByRole("textbox", { name: "닉네임", exact: true }).fill("남겨 둘 초안");
  await display.getByRole("combobox", { name: "모바일 화면 배율", exact: true }).selectOption("125");
  await display.getByRole("button", { name: "저장", exact: true }).click();
  await expect(profile.getByRole("textbox")).toHaveValue("남겨 둘 초안");
  await navigation.getByRole("button", { name: "기록 위로 이동", exact: true }).click();
  await expect(navigation.locator(".navigation-selection-label")).toHaveText(["상품", "기록", "할 일", "원칙"]);
  await navigation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(navigation.locator(".navigation-selection-label")).toHaveText(["상품", "할 일", "기록", "원칙"]);
  await navigation.getByRole("button", { name: "상품 숨기기", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "할 일 숨기기", exact: true })).toBeFocused();
  await navigation.getByRole("combobox", { name: "추가할 메뉴", exact: true }).selectOption("products");
  await navigation.getByRole("button", { name: "추가", exact: true }).click();
  await navigation.getByRole("button", { name: "저장", exact: true }).click();
  await expect(navigation.locator(".navigation-selection-label")).toHaveText(["할 일", "기록", "원칙", "상품"]);
  await expect(profile.getByRole("textbox")).toHaveValue("남겨 둘 초안");
  for (const width of [320, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await navigation.locator(".navigation-row-actions button").all()) {
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
    const dimensions = await page.locator("#buttons .material-settings-toolbar").evaluate((node) => {
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
  await expect(history.locator(".schema-definition-read").first()).toContainText("재고 수량 A");
  await expect(history.locator("input,select,textarea")).toHaveCount(0);
  await item.fill("재고 수량 B");
  await expect(history.locator(".schema-definition-read").first()).toContainText("재고 수량 A");
  await expect(history.locator(".schema-history-result").first()).toContainText("수량 → 재고 수량 A");
  await history.getByRole("button", { name: "변경 적용", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  await expect(item).toHaveValue("재고 수량 B");
  await history.getByRole("button", { name: "변경 적용", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "변경 적용", exact: true }).click();
  await expect(history.getByRole("button", { name: /현재 버전 2/ })).toBeVisible();
  await expect(item).toHaveValue("재고 수량 B");
  await workspace.getByRole("button", { name: "변경 검토", exact: true }).click();
  await history.getByRole("button", { name: "폐기", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "변경안 폐기" }).click();
  await expect(history.getByText("버전 3 · 폐기됨", { exact: true })).toBeVisible();
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
    const editor = page.locator("dialog.modal:not(.modal-confirm)[open]");
    let dialog = editor;
    await dialog.getByLabel("상품명").fill("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    dialog = page.locator("dialog.modal-confirm[open]");
    await expect(page.locator("dialog[open]")).toHaveCount(2);
    await expect(editor.getByLabel("상품명")).toHaveValue("머그컵");
    await dialog.getByLabel("기록 메모").fill("초안을 유지합니다");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    dialog = editor;
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "닫기" }).click();
    dialog = page.locator("dialog.modal-confirm[open]");
    await expect(dialog.getByRole("heading")).toHaveText("변경을 버릴까요?");
    await dialog.getByRole("button", { name: "계속 편집" }).click();
    dialog = editor;
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    dialog = page.locator("dialog.modal-confirm[open]");
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
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(samples.locator("dd")).toHaveText("머그컵");
    await expect(opener).toBeFocused();
    await samples.getByRole("button", { name: "예시 자료 삭제" }).click();
    dialog = page.locator("dialog.modal-confirm[open]");
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(448);
    await dialog.getByRole("button", { name: "취소", exact: true }).press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(samples.locator("dd")).toHaveText("머그컵");
  });
}

test("preview width changes keep the same live draft and dialog", async ({ page }) => {
  await page.goto("/design-samples/");
  const content = page.frameLocator("iframe");
  await page.getByRole("button", { name: "목록과 자료 설정", exact: true }).click();
  await content.getByRole("textbox", { name: "항목 이름" }).fill("폭을 바꿔도 유지");
  await page.getByRole("button", { name: "모바일", exact: true }).click();
  await expect(content.getByRole("textbox", { name: "항목 이름" })).toHaveValue("폭을 바꿔도 유지");
  await page.getByRole("button", { name: "모달과 확인", exact: true }).click();
  await content.getByRole("button", { name: "편집 모달 열기" }).click();
  await content.getByRole("dialog").getByLabel("상품명").fill("같은 모달");
  await page.getByRole("button", { name: "데스크톱", exact: true }).click();
  await expect(content.locator("dialog:not(.modal-confirm)[open]").getByLabel("상품명")).toHaveValue("같은 모달");
  await page.getByRole("button", { name: "모바일", exact: true }).click();
  await content.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  await content.locator("dialog.modal-confirm[open]").getByRole("button", { name: "변경 버리기" }).click();
  await page.getByRole("button", { name: "현재 화면", exact: true }).click();
});

test("invalid closed fields expand and focus; move controls retain the expanded row", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  await workspace.getByRole("button", { name: "상품명 텍스트 · 필수 · 자료 이름", exact: true }).focus();
  await page.keyboard.press("Enter");
  const row = workspace.locator('[data-property-id="prop_1"]');
  await expect(row.getByRole("textbox", { name: "항목 이름" })).toBeFocused();
  const field = workspace.locator("#sample-prop_1-body");
  await field.locator("summary").click();
  await field.getByLabel("최대 길이").fill("0");
  await field.locator("summary").click();
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
    await workspace.locator(".schema-order-actions .body-action-face svg").first().evaluate((node) =>
      getComputedStyle(node).width
    ),
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
    const dialog = page.getByRole("dialog");
    const geometry = await dialog.evaluate((node) => {
      const box = node.getBoundingClientRect(), inner = node.querySelector(".modal-inner")!.getBoundingClientRect();
      return {
        extraHeight: box.height - inner.height,
        centerY: box.top + box.height / 2,
        centerX: box.left + box.width / 2,
        modal: node.matches(":modal"),
        backdrop: getComputedStyle(node, "::backdrop").backgroundColor,
      };
    });
    expect(geometry.extraHeight, `unnecessary blank height at ${viewport.width}×${viewport.height}`)
      .toBeLessThanOrEqual(4);
    expect(Math.abs(geometry.centerY - viewport.height / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.centerX - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(geometry.modal).toBe(true);
    expect(geometry.backdrop).toBe("rgba(0, 0, 0, 0.6)");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator("#dialogs").getByRole("button", { name: "편집 모달 열기" }).click();
  const dialog = page.getByRole("dialog");
  expect((await dialog.boundingBox())!.height).toBe(800);
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  const geometry = await page.locator("dialog.modal-confirm[open]").evaluate((node) => ({
    box: node.getBoundingClientRect().height,
    inner: node.querySelector(".modal-inner")!.getBoundingClientRect().height,
  }));
  expect(geometry.box - geometry.inner).toBeLessThanOrEqual(4);
});

test("history expansion preserves the same section surface as other settings", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  const input = workspace.getByRole("region", { name: "입력 항목", exact: true });
  const history = workspace.getByRole("region", { name: "변경 이력", exact: true });
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const sections = await workspace.locator(".material-settings-section").evaluateAll((elements) =>
      elements.map((el) => {
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      })
    );
    for (let index = 1; index < sections.length; index++) {
      expect(sections[index].top - sections[index - 1].bottom, `section gap at ${width}px`).toBeCloseTo(20, 0);
    }
    const reference = await input.evaluate((node) => {
      const css = getComputedStyle(node);
      return { padding: css.padding, border: css.borderWidth, background: css.backgroundColor };
    });
    for (const open of [true, false]) {
      await history.getByRole("button", { name: /변경 이력 현재 버전/ }).click();
      await expect(history).toHaveAttribute("data-open", String(open));
      expect(
        await history.evaluate((node) => {
          const css = getComputedStyle(node);
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
  await expect(tags.locator(".tag-selection .chip")).toHaveCount(0);
  await opener.click();
  const modal = page.getByRole("dialog", { name: "기본 기록 태그 선택", exact: true });
  await expect(modal.getByRole("searchbox", { name: "태그 이름 검색" })).toBeFocused();
  await modal.getByRole("checkbox", { name: "중요", exact: true }).check();
  await modal.getByRole("searchbox").fill("진행");
  await expect(modal.getByRole("checkbox")).toHaveCount(1);
  await modal.getByRole("checkbox", { name: "진행 중", exact: true }).check();
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
  await expect(tags.locator(".tag-selection .chip")).toHaveCount(0);
});

test("tag modal preserves unknown and excluded selections and supports single replacement and limits", async ({ page }) => {
  await page.goto(direct);
  const mode = page.getByLabel("태그 예시 상태");
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const opener = tags.getByRole("button", { name: "태그 선택", exact: true });
  const modal = page.getByRole("dialog", { name: "기본 기록 태그 선택", exact: true });
  for (const state of ["loading", "failure", "unknown", "excluded"]) {
    await mode.selectOption(state);
    await expect(tags.locator(".tag-selection .chip")).toHaveCount(1);
    await tags.locator(".tag-selection .chip").click();
    await expect(tags.locator(".tag-selection .chip")).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  await mode.selectOption("excluded");
  await opener.click();
  await expect(modal.getByRole("checkbox", { name: "중요", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(tags.getByRole("button", { name: "중요 선택 해제", exact: true })).toBeVisible();
  await mode.selectOption("busy");
  await expect(opener).toBeDisabled();
  await expect(tags.getByRole("button", { name: "모든 태그 선택 해제" })).toBeDisabled();
  await mode.selectOption("single");
  await opener.click();
  await modal.getByRole("checkbox", { name: "중요", exact: true }).check();
  await modal.getByRole("checkbox", { name: "진행 중", exact: true }).check();
  await expect(modal.getByRole("checkbox", { name: "중요", exact: true })).not.toBeChecked();
  await expect(modal.getByText("1개 선택", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "선택 완료", exact: true }).click();
  await mode.selectOption("many");
  await opener.click();
  const choices = modal.getByRole("checkbox");
  for (let i = 0; i < 10; i++) await choices.nth(i).check();
  await expect(choices.nth(10)).toBeDisabled();
  await expect(modal).toContainText("최대 10개");
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = (await modal.boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    expect((await modal.getByRole("button", { name: "선택 완료" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(modal.getByRole("button", { name: "선택 완료" })).toBeInViewport();
  await choices.first().uncheck();
  await expect(choices.nth(10)).toBeEnabled();
  await page.evaluate(() => document.documentElement.style.zoom = "");
  await modal.getByRole("button", { name: "선택 완료", exact: true }).click();
});

test("property choices and native disclosures share production touch targets", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  const advanced = workspace.locator(".schema-field[data-expanded] details").first();
  const summary = advanced.locator("summary");
  await summary.click();
  const label = advanced.locator(".choice-control").first();
  await expect(label).toBeVisible();
  expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const input = label.locator("input"), before = await input.isChecked();
  await label.click();
  await expect(input).toBeChecked({ checked: !before });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(label).toBeHidden();
  await page.keyboard.press("Space");
  await expect(label).toBeVisible();
  const marker = await summary.evaluate((el) => ({
    display: getComputedStyle(el).display,
    column: getComputedStyle(el, "::after").gridColumnStart,
    list: getComputedStyle(el).listStyleType,
  }));
  expect(marker).toEqual({ display: "grid", column: "2", list: "none" });
});

test("single-choice and record-action samples preserve keyboard meaning and hidden drafts", async ({ page }) => {
  await page.goto(direct);
  const form = page.locator("#forms");
  await form.getByRole("radio", { name: "매일", exact: true }).press("ArrowRight");
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
  await chooser.getByRole("checkbox", { name: "프로젝트", exact: true }).check();
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
  await modal.getByRole("checkbox", { name: "중요", exact: true }).check();
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
  await expect(tags.locator(".tag-selection .chip")).toHaveCount(0);
  await mode.selectOption("empty");
  await opener.click();
  await expect(modal.getByText("태그 관리에서 태그를 먼저 추가하세요.", { exact: true })).toBeVisible();
  await modal.getByRole("searchbox", { name: "태그 이름 검색" }).fill("없는 이름");
  await expect(modal.getByText("일치하는 태그가 없습니다.", { exact: true })).toBeVisible();
});
