import { expect, type Page, type Locator } from "@playwright/test";

/** A desktop visit closes through its tab; narrow screens keep the native dialog close control. */
export async function closeDetail(page: Page, title: string) {
  const dialog = page.locator("dialog.modal:not(.modal-confirm)[open]");
  await expect(dialog).toBeVisible();
  const tabClose = page.getByRole("button", { name: `${title} 탭 닫기`, exact: true });
  if (await dialog.evaluate(el => el.classList.contains("detail-docked"))) await tabClose.click();
  else await dialog.getByRole("button", { name: "닫기", exact: true }).click();
}

/** Complete a save through its public confirmation stage when the domain requires a change record. */
export async function saveOnce(page: Page, scope: Page | Locator = page, label = "저장", waitForWrite = true) {
  const final = page.locator("dialog.modal-action[open]").getByRole("button", {name:/^(등록|수정|중단|재개)하고 저장$|^삭제하고 기록$|^같은 내용 다시 시도$/});
  const requested = scope.getByRole("button", {name:label === "삭제 확인" ? "삭제하고 기록" : label,exact:true});
  if (await requested.isVisible()) {
    await requested.click();
    if ((label === "저장" || label === "추가") && await final.isVisible()) await final.click();
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
  const actions: Record<string, [string,string]> = {"할 일 추가":["할 일","할 일 등록"],"기록 작성":["기록","기록 작성"],"엔터티 추가":["엔터티","엔터티 등록"],"현재 원칙 등록":["원칙","원칙 작성"]};
  const action = actions[label];
  if (!action) { await page.getByRole("button",{name:label,exact:true}).click(); return; }
  if (/^\/(entities|tasks|records|principles)\/?$/.test(new URL(page.url()).pathname)) { await page.getByRole("button",{name:action[1],exact:true}).click(); }
  else await page.getByRole("button",{name:label,exact:true}).click();
}

/** Enter editing through the viewer, keeping the dialog and navigation context. */
export async function openDetailEditor(page: Page) {
  await page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:"편집",exact:true}).click();
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:"저장",exact:true})).toBeVisible();
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
  const toggle=page.getByRole("button",{name:title,exact:true});
  if(await toggle.getAttribute("aria-expanded")!=="true")await toggle.click();
  await page.getByRole("link",{name:title+" 상세",exact:true}).click();
}

/** Open the visible common conditions group without toggling an already-open group. */
export async function openTabFilters(page: Page) {
  const toggle=page.getByRole("button",{name:/^필터 (열기|닫기)/});
  if(await toggle.count()) {
    if(await toggle.getAttribute("aria-expanded")==="false")await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded","true");
  }
}
