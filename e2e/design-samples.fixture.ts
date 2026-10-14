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
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("상품명").fill("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await dialog.getByLabel("기록 메모").fill("초안을 유지합니다");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await expect(dialog.getByRole("button", { name: "저장", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "닫기" }).click();
    await expect(dialog.getByRole("heading")).toHaveText("변경을 버릴까요?");
    await dialog.getByRole("button", { name: "계속 편집" }).click();
    await expect(dialog.getByLabel("상품명")).toHaveValue("머그컵");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
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
    dialog = page.getByRole("dialog");
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
  await expect(content.getByRole("dialog").getByLabel("상품명")).toHaveValue("같은 모달");
  await page.getByRole("button", { name: "모바일", exact: true }).click();
  await content.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  await content.getByRole("dialog").getByRole("button", { name: "변경 버리기" }).click();
  await page.getByRole("button", { name: "현재 화면", exact: true }).click();
});

test("invalid closed fields expand and focus; move controls retain the expanded row", async ({ page }) => {
  await page.goto(direct);
  const workspace = page.locator("#workspace");
  await workspace.getByRole("button", { name: "상품명 펼치기", exact: true }).click();
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
  await expect(field.getByLabel("항목 이름")).toHaveValue("상품명");
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
  const geometry = await dialog.evaluate((node) => ({
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
