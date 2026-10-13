import { expect, type Page, type Locator } from "@playwright/test";

/** A desktop visit closes through its tab; narrow screens keep the native dialog close control. */
export async function closeDetail(page: Page, title: string) {
  const dialog = page.locator("dialog.modal:not(.modal-confirm)[open]:visible");
  await expect(dialog).toBeVisible();
  const tabClose = page.getByRole("button", { name: `${title} 탭 닫기`, exact: true });
  if (await dialog.evaluate(el => el.classList.contains("detail-docked"))) await tabClose.click();
  else await dialog.getByRole("button", { name: "닫기", exact: true }).click();
}

/** Complete a save through its public confirmation stage when the domain requires a change record. */
export async function saveOnce(page: Page, scope: Page | Locator = page, label = "저장", waitForWrite = true) {
  const issuer = scope.getByLabel("발급처",{exact:false});
  if(await issuer.isVisible() && !await page.getByRole("dialog",{name:/복원$/,exact:false}).isVisible())await expect(issuer).toBeEnabled();
  const final = page.locator("dialog.modal-action[open]").getByRole("button", {name:/^(등록|수정|중단|재개|복원|식별 정보 변경)하고 저장$|^삭제하고 기록$|^같은 내용 다시 시도$/});
  const requested = scope.getByRole("button", {name:label === "삭제 확인" ? "삭제하고 기록" : label,exact:true});
  if (await requested.isVisible()) {
    await requested.click();
    if ((label === "저장" || label === "추가" || label === "변경") && await final.isVisible()) await final.click();
  } else await final.click();
  if (waitForWrite) await expect(page.locator("dialog.modal-action[open] .modal-foot button:disabled")).toHaveCount(0);
}

export async function discardEditor(page: Page) {
  if (await page.locator("dialog.modal-action[open]").isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}

export async function fillChangeMemo(page: Page, scope: Page | Locator, value: string) {
  const memo=page.locator("dialog.modal-action[open]").getByLabel("기록 메모",{exact:true});
  if (!await memo.isVisible()) await scope.getByRole("button",{name:/^저장$|^추가$/}).click();
  await memo.fill(value);
}

/** Exercise the primary creation action; detail-page actions remain direct. */
export async function beginTabAction(page: Page, label: string) {
  const actions: Record<string, [string,string]> = {"할 일 추가":["할 일","할 일 등록"],"기록 작성":["기록","기록 작성"],"검사 자료 추가":["검사 자료","검사 자료 추가"],"현재 원칙 등록":["원칙","원칙 작성"]};
  if (label === "검사 자료 추가") {
    const header = page.locator(".main-tab-header");
    const picker = header.getByLabel("자료 종류", { exact: true });
    if (await picker.count() && !(await picker.inputValue())) {
      await expect(picker).toBeEnabled();
      const option = picker.locator('option[value]:not([value=""])').first();
      await picker.selectOption(await option.getAttribute("value") ?? "");
    }
    await page.getByRole("button", { name: /^(검사 자료.*|자료) 추가$/, exact: true }).click();
    return;
  }
  const action = actions[label];
  if (!action) { await page.getByRole("button",{name:label,exact:true}).click(); return; }
  if (/^\/(entities|tasks|records|principles)\/?$/.test(new URL(page.url()).pathname)) { await page.getByRole("button",{name:action[1],exact:true}).click(); }
  else await page.getByRole("button",{name:label,exact:true}).click();
}

/** Enter editing through the viewer, keeping the dialog and navigation context. */
export async function openDetailEditor(page: Page) {
  await page.locator("dialog.modal:not(.modal-confirm)[open]:visible").getByRole("button", {name:"편집",exact:true}).click();
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]:visible").getByRole("button", {name:"저장",exact:true})).toBeVisible();
}

export async function openListEditor(page: Page, title: string, scope: Page | Locator = page) {
  if(new URL(page.url()).pathname==="/principles") {
    await scope.getByRole("link",{name:title,exact:true}).click();
  } else {
    await openListDetail(page,title);
  }
  await openDetailEditor(page);
}

/** Main lists disclose first; full relation/workflow actions belong to the existing detail. */
export async function openListDetail(page: Page, title: string) {
  const list=page.locator(".workspace-list, .app-main > .activity-section").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  const toggle=list.getByRole("button",{name:title,exact:true});
  if(await toggle.getAttribute("aria-expanded")!=="true")await toggle.click();
  await list.getByRole("link",{name:title+" 상세",exact:true}).click();
}

/** Open the visible common conditions group without toggling an already-open group. */
export async function openTabFilters(page: Page) {
  const toggle=page.getByRole("button",{name:/^필터 (열기|닫기)/});
  await expect(toggle).toBeVisible();
  if(await toggle.getAttribute("aria-expanded")==="false")await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded","true");
}

/** Enter a live scalar condition using the current type definition. */
export async function setEntityCategory(page: Page, value: string) {
  const header = page.locator(".main-tab-header");
  const picker = header.getByLabel("자료 종류", { exact: true });
  if (!(await picker.inputValue())) {
    const option = picker.locator('option[value]:not([value=""])').first();
    await picker.selectOption(await option.getAttribute("value") ?? "");
  }
  await openTabFilters(page);
  if (value) {
    if (!await header.getByLabel("조건 1 속성", { exact: true }).count()) await header.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
    await header.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_4");
    await header.getByLabel("조건 1 값", { exact: true }).selectOption(value);
  } else await header.getByRole("button", { name: "조건 1 제거", exact: true }).click();
  await header.getByRole("button", { name: "속성 조건 적용", exact: true }).click();
}

/** Reveal optional settings through their visible disclosure controls. */
export async function revealSetting(control: import("@playwright/test").Locator) {
  for (const details of await control.locator("xpath=ancestor::details").all()) {
    if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
  }
}
