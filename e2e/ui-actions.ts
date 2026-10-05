import { expect, type Page } from "@playwright/test";
/** Exercise the visible top-level task menu; detail-page actions remain direct. */
export async function beginTabAction(page: Page, label: string) {
  const actions: Record<string, [string,string]> = {"할 일 추가":["활동","할 일 등록"],"기록 작성":["활동","기록 작성"],"엔터티 추가":["엔터티","엔터티 등록"],"현재 원칙 등록":["원칙","원칙 작성"]};
  const action = actions[label];
  if (!action) { await page.getByRole("button",{name:label,exact:true}).click(); return; }
  const trigger = page.getByRole("button",{name:`${action[0]} 작업 메뉴`,exact:true});
  if (await trigger.count() || /^\/(entities|tasks|records|principles)\/?$/.test(new URL(page.url()).pathname)) { await trigger.click(); await page.getByRole("button",{name:action[1],exact:true}).click(); }
  else await page.getByRole("button",{name:label,exact:true}).click();
}

/** Test existing edit_from=view deep links; ordinary list edit controls are tested separately. */
export async function openDetailEditor(page: Page) {
  const next = new URL(page.url());
  if (!next.pathname.startsWith("/entities/")) {
    next.searchParams.set("edit", "1"); next.searchParams.set("edit_from", "view");
    await page.goto(next.toString());
  }
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:"저장", exact:true})).toBeVisible();
}
