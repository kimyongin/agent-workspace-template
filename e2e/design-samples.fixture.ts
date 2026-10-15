import { expect, test } from "@playwright/test";
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
  ).toBe("12px");
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
    const sections = await workspace.locator(".material-settings-section").evaluateAll((elements) => elements.map((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }));
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

test("tag clear is a contextual action outside the choices and restores keyboard focus", async ({ page }) => {
  await page.goto(direct);
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const clear = tags.getByRole("button", { name: "모든 태그 선택 해제", exact: true });
  await expect(clear).toHaveCount(0);
  await expect(tags.locator(".tag-selection button")).toHaveCount(3);
  const offset = () =>
    tags.evaluate((node) =>
      node.querySelector(".tag-selection")!.getBoundingClientRect().top - node.getBoundingClientRect().top
    );
  const before = await offset();
  await tags.getByRole("button", { name: "중요", exact: true }).click();
  await expect(tags).toHaveAccessibleName("기본 기록 태그");
  await expect(clear).toBeVisible();
  await expect(tags.locator(".tag-selection").getByRole("button", { name: "모든 태그 선택 해제" })).toHaveCount(0);
  expect(await offset()).toBe(before);
  await tags.getByRole("button", { name: "진행 중", exact: true }).click();
  await tags.getByRole("button", { name: "중요", exact: true }).click();
  await expect(tags.getByRole("button", { name: "중요", exact: true })).toHaveAttribute("aria-pressed", "false");
  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(tags.getByRole("button", { name: "중요", exact: true })).toBeFocused();
  await expect(tags.locator("[aria-pressed=true]")).toHaveCount(0);
  expect(await offset()).toBe(before);
  for (const width of [320, 390, 639, 640, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await tags.getByRole("button", { name: "중요", exact: true }).click();
    const box = (await clear.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await clear.click();
  }
});

test("tag selection handles empty, missing, loading, failure, busy and the ten-tag limit", async ({ page }) => {
  await page.goto(direct);
  const mode = page.getByLabel("태그 예시 상태");
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const clear = tags.getByRole("button", { name: "모든 태그 선택 해제", exact: true });
  await mode.selectOption("empty");
  await expect(tags.getByRole("button")).toHaveCount(0);
  await expect(tags).toContainText("태그 관리에서 태그를 먼저 추가하세요.");
  for (const state of ["loading", "failure"]) {
    await mode.selectOption(state);
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(clear).toHaveCount(0);
    await expect(tags.locator("legend")).toBeFocused();
  }
  await mode.selectOption("unknown");
  await tags.getByRole("button", { name: "이름 확인이 필요한 태그 1 선택 해제", exact: true }).click();
  await expect(tags.locator("legend")).toBeFocused();
  await expect(clear).toHaveCount(0);
  await mode.selectOption("busy");
  await expect(clear).toBeDisabled();
  await expect(tags.getByRole("button", { name: "중요", exact: true })).toBeDisabled();
  await mode.selectOption("many");
  const choices = tags.locator(".tag-selection button");
  for (let i = 0; i < 10; i++) await choices.nth(i).click();
  await expect(choices.nth(10)).toBeDisabled();
  await expect(tags.getByRole("status")).toContainText("최대 10개");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await choices.first().click();
  await expect(choices.nth(10)).toBeEnabled();
  await expect(tags.getByRole("status")).toHaveCount(0);
  await clear.click();
  await expect(choices.filter({ has: page.locator("[aria-pressed=true]") })).toHaveCount(0);
  await page.evaluate(() => document.documentElement.style.fontSize = "");
});

test("tag clear retains list position with the template label at 200%", async ({ page }) => {
  await page.goto(direct);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const tags = page.getByRole("group", { name: "기본 기록 태그", exact: true });
  const offset = () =>
    tags.evaluate((node) =>
      node.querySelector(".tag-selection")!.getBoundingClientRect().top - node.getBoundingClientRect().top
    );
  const before = await offset();
  await tags.getByRole("button", { name: "중요", exact: true }).click();
  expect(await offset()).toBe(before);
  await tags.getByRole("button", { name: "모든 태그 선택 해제", exact: true }).click();
  expect(await offset()).toBe(before);
  await page.evaluate(() => document.documentElement.style.fontSize = "");
});
