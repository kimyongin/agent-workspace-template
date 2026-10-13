import { entity } from "./support/workspace-data.ts";
import { expect, test } from "@playwright/test";
import { form, fixtures, go } from "./support/workspace-screens.ts";
import { entityKey, id } from "./support/workspace-data.ts";

test("#335 준비 충돌 후 확인 취소는 초안을 보존하고 편집 취소는 최신 완료 상태를 읽는다", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/tasks/${id(2)}?edit=1`);
  await form(page).getByLabel("제목", { exact: false }).fill("보존할 제목 초안");
  Object.assign(state.rows.tasks[0], { body: "다른 접점의 최신 조사 결과", version: 2, status: "done" });
  await page.route("**/api/records/prepare", route => route.fulfill({ status: 409,
    json: { code: "conflict", message: "다른 변경이 저장되어 있습니다. 다시 조회하세요.", retryable: false } }));
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = page.locator("dialog.modal-action[open]");
  await expect(confirmation).toContainText("다른 변경이 저장되어 있습니다.");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByLabel("제목", { exact: false })).toHaveValue("보존할 제목 초안");
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await expect(form(page)).toContainText("다른 접점의 최신 조사 결과");
  await expect(form(page).getByRole("button", { name: "완료하고 기록", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const [kind, n, label] of [["entities", 1, "제목"], ["tasks", 2, "제목"], ["principles", 4, "제목"]] as const) {
  for (const stage of ["prepare", "write"] as const) {
    test(`#335 ${kind}: ${stage} 충돌 후 초안 보존·최신 조회`, async ({ page }) => {
      const state = await fixtures(page, stage === "write" ? { failWrite: "conflict" } : {});
      const key = kind === "entities" ? entityKey(n) : id(n);
      await go(page, `/${kind}/${encodeURIComponent(key)}?edit=1`);
      await form(page).getByLabel(label, { exact: false }).fill("보존할 이름 초안");
      const row = state.rows[kind][0];
      Object.assign(row, kind === "entities" ? { ...entity(1, { prop_1: "다른 접점의 최신 이름" }), version: 2 }
        : { title: "다른 접점의 최신 이름", body: "다른 접점의 최신 본문", version: 2 });
      if (stage === "prepare") await page.route("**/api/records/prepare", route => route.fulfill({ status: 409,
        json: { code: "conflict", message: "다른 변경이 저장되어 있습니다.", retryable: false } }));
      await form(page).getByRole("button", { name: "저장", exact: true }).click();
      const confirmation = page.locator("dialog.modal-action[open]");
      if (stage === "write") await confirmation.getByRole("button", { name: "수정하고 저장", exact: true }).click();
      await expect(confirmation).toContainText("편집을 취소");
      await confirmation.getByRole("button", { name: "취소", exact: true }).click();
      await expect(form(page).getByLabel(label, { exact: false })).toHaveValue("보존할 이름 초안");
      await form(page).getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
      await expect(form(page)).toContainText("다른 접점의 최신 이름");
      if (kind !== "entities") await expect(form(page)).toContainText("다른 접점의 최신 본문");
      expect(state.writes).toHaveLength(stage === "write" ? 1 : 0);
      expect(state.errors).toEqual([]);
    });
  }
}

test("#396 preparation field errors survive returning to the entity editor", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}?edit=1`);
  await form(page).getByLabel("수량", {exact:true}).fill("10");
  await page.route("**/api/records/prepare", route => route.fulfill({status:400,
    json:{code:"invalid_input",message:"속성 값을 확인하세요",retryable:false,
      fields:[{path:"properties.prop_2",message:"5 이하여야 합니다"}]}}));
  await form(page).getByRole("button",{name:"저장",exact:true}).click();
  const confirmation=page.locator("dialog.modal-action[open]");
  await expect(confirmation).toContainText("속성 값을 확인하세요");
  await confirmation.getByRole("button",{name:"입력 수정",exact:true}).click();
  await expect(form(page)).toContainText("5 이하여야 합니다");
  await expect(form(page).getByLabel("수량",{exact:true})).toBeFocused();
  await expect(form(page).getByLabel("수량",{exact:true})).toHaveValue("10");
  expect(state.writes).toHaveLength(0);
});

test("#396 schema conflicts keep the cancel action while preserving property drafts",async({page})=>{
  const state=await fixtures(page);
  await go(page,`/entities/${encodeURIComponent(entityKey(1))}?edit=1`);
  await form(page).getByLabel("수량",{exact:true}).fill("10");
  await page.route("**/api/records/prepare",route=>route.fulfill({status:409,
    json:{code:"schema_changed",message:"속성 정의가 변경되었습니다",retryable:false,
      fields:[{path:"schema_version",message:"최신 정의를 확인하세요"}]}}));
  await form(page).getByRole("button",{name:"저장",exact:true}).click();
  const confirmation=page.locator("dialog.modal-action[open]");
  await expect(confirmation).toContainText("속성 정의가 변경되었습니다");
  await expect(confirmation.getByRole("button",{name:"입력 수정",exact:true})).toHaveCount(0);
  await confirmation.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByLabel("수량",{exact:true})).toHaveValue("10");
  expect(state.writes).toHaveLength(0);
});
