import { expect, test } from "@playwright/test";
import { devLogin } from "./support.ts";

test("실제 계정 표시 시간대 저장·새로고침·다른 탭 반영 및 원래 설정 복원", async ({page, context}, info) => {
  await devLogin(page); await page.goto("/settings");
  const select=page.getByLabel("표시 시간대");await expect(select).toBeVisible();
  const metadata=await page.evaluate(async()=>{
    const path="/src/lib/supabase.ts",{supabase}=await import(path);
    const {data,error}=await supabase.auth.getUser();if(error)throw error;
    return data.user!.user_metadata;
  });
  const original=typeof metadata.workspace_timezone==="string"?metadata.workspace_timezone:null;
  const target=original==="UTC"?"Asia/Seoul":"UTC";
  const other=await context.newPage();await other.goto("/settings");
  try {
    await select.selectOption(target);await page.getByRole("button",{name:"시간대 저장",exact:true}).click();
    await expect(page.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("status")).toContainText("표시 시간대를 저장했습니다");
    await expect(other.getByLabel("표시 시간대")).toHaveValue(target);
    await page.reload();await expect(page.getByLabel("표시 시간대")).toHaveValue(target);
    const confirmed=await page.evaluate(async()=>{
      const path="/src/lib/supabase.ts",{supabase}=await import(path);
      const {data,error}=await supabase.auth.getUser();if(error)throw error;return data.user!.user_metadata;
    });
    expect(confirmed).toEqual({...metadata,workspace_timezone:target});
    await page.screenshot({path:info.outputPath("timezone-settings.png"),fullPage:true});
  } finally {
    await page.goto("/settings");await page.getByLabel("표시 시간대").selectOption(original??"");
    const save=page.getByRole("button",{name:"시간대 저장",exact:true});
    if(await save.isEnabled()){await save.click();await expect(page.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("status")).toContainText("표시 시간대를 저장했습니다");}
    await other.close();
  }
});
