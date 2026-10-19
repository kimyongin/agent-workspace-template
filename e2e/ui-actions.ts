import { businessPath } from "../src/lib/workspace-route.tsx";
import { expect, type Locator, type Page, type Request } from "@playwright/test";

/** Visible overlay boundaries include the visually retained editor behind a modal confirmation. */
export const executionDialog = (page: Page) => page.getByRole("dialog").filter({
  has: page.getByRole("heading", { name: /하시겠습니까\?$/ }),
});
export const detailDialog = (page: Page) => page.getByRole("dialog", { includeHidden: true }).and(page.locator(':not([data-state="closed"])')).filter({ visible: true }).filter({ hasNot: page.getByRole("heading", { name: /하시겠습니까\?$|^변경을 버릴까요\?$| 선택$/ }) });
export const openDialogs = (page: Page) => page.getByRole("dialog", { includeHidden: true }).or(page.getByRole("alertdialog", { includeHidden: true })).filter({ visible: true });
export const baseWorkspace = (page: Page) => page.getByRole("region", { name: "기본 작업 영역", exact: true });

export const shortDialog = (page: Page) => page.getByRole("alertdialog").or(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /하시겠습니까\?$| 선택$/ }) }));
export const listHeader = (page: Page) => page.getByRole("region").filter({ has: page.getByRole("textbox", { name: /^(자료 제목 검색|검색어)$/ }) }).last();

/** Open the responsive official Sidebar before using its links or profile menu. */
async function compactNavigation(page: Page) {
  return page.evaluate(() => matchMedia("(max-width: 1023px), (max-height: 319px)").matches);
}
export async function openMainNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
  const sheet = page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true });
  if (await compactNavigation(page)) {
    if (await sheet.count() && await sheet.getAttribute("data-state") === "closed") await expect(sheet).toHaveCount(0);
    if (!await sheet.count()) {
      await expect(trigger).toBeVisible();
      await trigger.click();
    }
    await expect(sheet).toHaveAttribute("data-state", "open");
    await expect(sheet).toBeVisible();
  } else {
    await expect(trigger).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
  }
  await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true })).toBeVisible();
}
/** Return to the protected page after a cancelled mobile navigation attempt. */
export async function closeMainNavigation(page: Page) {
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true, includeHidden: true })).toHaveCount(0);
  const sheet = page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true });
  if (await sheet.count()) {
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
  }
  await expect(sheet).toHaveCount(0);
}
export async function openProfileMenu(page: Page) {
  const compact = await compactNavigation(page);
  const trigger = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
  if (!compact) await expect(trigger).toHaveCount(0);
  const popup = page.getByRole("menu", { includeHidden: true }).filter({ has: page.getByRole("menuitem", { name: "로그아웃", exact: true, includeHidden: true }) });
  const alreadyOpen = await popup.evaluateAll(elements => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse";
    };
    const compact = matchMedia("(max-width: 1023px), (max-height: 319px)").matches;
    const sheets = [...document.querySelectorAll('[role="dialog"][data-sidebar="sidebar"][data-mobile="true"]')];
    const popupOpen = elements.some(element => element.getAttribute("data-state") === "open" && visible(element));
    const sheetOpen = sheets.some(element => element.getAttribute("data-state") === "open" && visible(element));
    return popupOpen && (compact ? sheetOpen : sheets.length === 0);
  });
  if (alreadyOpen) return;
  // A responsive navigation owner may unmount its old popup; closing Presence is not an open menu.
  await expect(popup).toHaveCount(0);
  await openMainNavigation(page);
  const profile = page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true });
  await expect(profile).toBeVisible();
  if (await profile.getAttribute("aria-expanded") !== "true") await profile.click();
  await expect(popup).toHaveAttribute("data-state", "open");
  await expect(popup).toBeVisible();
}

/** Searchable type selection is exercised through the displayed domain label. */
export async function chooseEntityType(page: Page, label?: string, scope: Page | Locator = page) {
  const picker = scope.getByRole("combobox", { name: "자료 종류", exact: true });
  await expect(picker).toBeEnabled();
  await picker.click();
  await picker.press("ArrowDown");
  const option = label ? page.getByRole("option", { name: label, exact: true })
    : page.getByRole("option").filter({ hasNotText: /^(자료 종류 선택|전체 자료)$/ }).first();
  await expect(option).toBeVisible();
  await option.click();
}


/** Close the visible visit through its available desktop tab or mobile dismissal. */
export async function closeDetail(page: Page, title: string) {
  const dialog = detailDialog(page);
  await expect(dialog).toBeVisible();
  const tabClose = page.getByRole("button", { name: `${title} 탭 닫기`, exact: true });
  const dialogClose = dialog.getByRole("button", { name: "닫기", exact: true });
  await tabClose.or(dialogClose).filter({ visible: true }).first().click();
}

/** Complete a save through its public confirmation stage when the domain requires a change record. */
export async function saveOnce(page: Page, scope: Page | Locator = page, label = "저장", waitForWrite = true) {
  const final = executionDialog(page).getByRole("button", {
    name: /^(등록|수정|중단|재개|복원|식별 정보 변경|연결|해제)하고 저장$|^삭제하고 기록$|^같은 내용 다시 시도$/,
  });
  const requested = scope.getByRole("button", { name: label === "삭제 확인" ? "삭제하고 기록" : label, exact: true });
  let write: Request | undefined, settled = false;
  const started = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (!write && /\/api\//.test(path) && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !/\/(search|prepare)$/.test(path)) write = request;
  };
  const finished = (request: Request) => { if (request === write) settled = true; };
  page.on("request", started); page.on("requestfinished", finished); page.on("requestfailed", finished);
  try {
    if (await final.isVisible()) await final.click();
    else if (await requested.isVisible()) {
      await requested.click();
      // Preparation can mount a confirmation asynchronously. Background role hiding is not a save result.
      await expect.poll(async () => !!write || await final.isVisible()).toBe(true);
      if (await final.isVisible()) await final.click();
    } else await final.click();
    if (waitForWrite) {
      await expect.poll(() => !!write && settled).toBe(true);
      // Unknown results keep prepared fields locked; only the action footer becomes ready again.
      await expect.poll(async () => {
        if (await executionDialog(page).count() === 0) return true;
        const cancel = executionDialog(page).getByRole("button", { name: "취소", exact: true });
        return await final.count() === 1 && await final.isEnabled()
          && await cancel.count() === 1 && await cancel.isEnabled();
      }).toBe(true);
    }
  } finally {
    page.off("request", started); page.off("requestfinished", finished); page.off("requestfailed", finished);
  }
}

export async function discardEditor(page: Page) {
  if (await executionDialog(page).isVisible()) {
    await page.keyboard.press("Escape");
    await expect(executionDialog(page)).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}

export async function fillChangeMemo(page: Page, scope: Page | Locator, value: string) {
  const memo = executionDialog(page).getByLabel("기록 메모", { exact: true });
  if (!await memo.isVisible()) await scope.getByRole("button", { name: /^저장$|^추가$/ }).click();
  await memo.fill(value);
}

/** Exercise the primary creation action; detail-page actions remain direct. */
export async function beginTabAction(page: Page, label: string) {
  const actions: Record<string, [string, string]> = {
    "할 일 추가": ["할 일", "할 일 등록"],
    "기록 작성": ["기록", "기록 작성"],
    "검사 자료 추가": ["검사 자료", "검사 자료 추가"],
  };
  if (label === "검사 자료 추가") {
    const picker = page.getByRole("combobox", { name: "자료 종류", exact: true });
    if (await picker.count() && /^(?:|전체 자료|자료 종류 선택)$/.test(await picker.inputValue())) await chooseEntityType(page);
    await page.getByRole("button", { name: /^(검사 자료.*|자료) 추가$/, exact: true }).click();
    return;
  }
  const action = actions[label];
  if (!action) {
    await page.getByRole("button", { name: label, exact: true }).click();
    return;
  }
  if (/^\/(entities|tasks|records)\/?$/.test(businessPath(new URL(page.url()).pathname))) {
    await page.getByRole("button", { name: action[1], exact: true }).click();
  } else await page.getByRole("button", { name: label, exact: true }).click();
}

/** Enter editing through the viewer, keeping the dialog and navigation context. */
export async function openDetailEditor(page: Page) {
  await detailDialog(page).getByRole("button", {
    name: "편집",
    exact: true,
  }).click();
  await expect(
    detailDialog(page).getByRole("button", { name: "저장", exact: true }),
  ).toBeVisible();
}

export async function openListEditor(page: Page, title: string) {
  await openListDetail(page, title);
  await openDetailEditor(page);
}

/** Main lists disclose first; full relation/workflow actions belong to the existing detail. */
export async function openListDetail(page: Page, title: string) {
  const list = page.getByRole("region", { name: / 목록$/ }).filter({ has: page.getByRole("button", { name: title, exact: true }) }).first();
  const toggle = list.getByRole("button", { name: title, exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await list.getByRole("link", { name: title + " 상세", exact: true }).click();
}

/** Open the visible common conditions group without toggling an already-open group. */
export async function openTabFilters(page: Page) {
  const toggle = page.getByRole("button", { name: /^필터 (열기|닫기)/ });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Enter a live scalar condition using the current type definition. */
export async function setEntityCategory(page: Page, value: string) {
  const header = page.getByRole("region").filter({ has: page.getByRole("combobox", { name: "자료 종류", exact: true }) }).last();
  const picker = header.getByRole("combobox", { name: "자료 종류", exact: true });
  if (/^(?:|전체 자료|자료 종류 선택)$/.test(await picker.inputValue())) await chooseEntityType(page, undefined, header);
  await openTabFilters(page);
  if (value) {
    if (!await header.getByLabel("조건 1 속성", { exact: true }).count()) {
      await header.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
    }
    await header.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_4");
    await header.getByLabel("조건 1 값", { exact: true }).selectOption(value);
  } else await header.getByRole("button", { name: "조건 1 제거", exact: true }).click();
  await header.getByRole("button", { name: "필터 적용", exact: true }).click();
}

/** Reveal optional settings through their visible disclosure controls. */
export async function revealSetting(control: import("@playwright/test").Locator) {
  const groups = await control.locator("xpath=ancestor::*[@data-slot='collapsible' or self::details]").all();
  for (const group of groups) {
    if (await group.getAttribute("data-slot") === "collapsible") {
      if (await group.getAttribute("data-state") === "closed") {
        await group.locator(":scope > [data-slot='collapsible-trigger']").click();
      }
    } else if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
  }
}

/** Choose tags through the shared modal; parent filters/save remain the commit boundary. */
export async function chooseTag(page: Page, scope: Page | Locator, name: string, checked = true) {
  await scope.getByRole("button", { name: "태그 선택", exact: true }).click();
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "선택 완료", exact: true }) });
  const option = picker.getByRole("option", { name, exact: true });
  await expect(option).toBeVisible();
  if (await option.getAttribute("aria-checked") !== String(checked)) await option.click();
  await picker.getByRole("button", { name: "선택 완료", exact: true }).click();
  await expect(picker).toHaveCount(0);
}

export async function applyTabFilters(page: Page) {
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
}
