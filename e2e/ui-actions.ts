import { expect, type Page, type Locator } from "@playwright/test";

/** Follow the visible preview/commit flow; retries keep their original request. */
export async function saveWithMemo(page: Page, scope: Page | Locator = page, label = "저장") {
  const preview = scope.getByRole("button", {name:"기록 메모 확인",exact:true});
  if (await preview.count()) {
    await preview.click();
    await scope.getByRole("button", {name:label === "삭제" ? "삭제" : "확인하고 저장",exact:true}).click();
  } else {
    const commit = scope.getByRole("button", {name:"확인하고 저장",exact:true});
    if (await commit.count()) await commit.click();
    else await scope.getByRole("button", {name:label,exact:true}).click();
  }
}

/** Fixtures return a public read-only preview, never a mock business mutation. */
export async function fixtureMemoPreview(page: Page) {
  await page.route(/\/api\/(entities|tasks|principles)\/preview$/, route => route.fulfill({json:{
    memo:{title:"업무 변경",summary:"확인한 업무 변경 내용",body:"업무 변경 전 확인한 내용"},changed:true,
  }}));
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

/** Test existing edit_from=view deep links; ordinary list edit controls are tested separately. */
export async function openDetailEditor(page: Page) {
  const next = new URL(page.url());
  if (!next.pathname.startsWith("/entities/")) {
    next.searchParams.set("edit", "1"); next.searchParams.set("edit_from", "view");
    await page.goto(next.toString());
  }
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("button", {name:/^(저장|기록 메모 확인)$/})).toBeVisible();
}
