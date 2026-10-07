import { expect, type Page, type Locator } from "@playwright/test";

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

/** Exercise the visible top-level task menu; detail-page actions remain direct. */
export async function beginTabAction(page: Page, label: string) {
  const actions: Record<string, [string,string]> = {"할 일 추가":["할 일","할 일 등록"],"기록 작성":["기록","기록 작성"],"엔터티 추가":["엔터티","엔터티 등록"],"현재 원칙 등록":["원칙","원칙 작성"]};
  const action = actions[label];
  if (!action) { await page.getByRole("button",{name:label,exact:true}).click(); return; }
  const trigger = page.getByRole("button",{name:`${action[0]} 작업 메뉴`,exact:true});
  if (await trigger.count() || /^\/(entities|tasks|records|principles)\/?$/.test(new URL(page.url()).pathname)) { await trigger.click(); await page.getByRole("button",{name:action[1],exact:true}).click(); }
  else await page.getByRole("button",{name:label,exact:true}).click();
}

/** Enter editing through the viewer, keeping the dialog and navigation context. */
export async function openDetailEditor(page: Page) {
  await page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:"편집",exact:true}).click();
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:"저장",exact:true})).toBeVisible();
}

export async function openListEditor(page: Page, title: string, scope: Page | Locator = page) {
  await scope.getByRole("link",{name:title,exact:true}).click();
  await openDetailEditor(page);
}
