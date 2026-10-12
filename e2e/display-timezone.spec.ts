import { expect } from "@playwright/test";
import { test, devLogin } from "./support.ts";

test("실제 계정 표시 저장·새로고침·다른 탭 반영 및 원래 설정 복원", async ({page, context}, info) => {
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
    await select.selectOption(target);await page.getByRole("button",{name:"날짜와 시각 저장",exact:true}).click();
    await expect(page.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");
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
    const save=page.getByRole("button",{name:"날짜와 시각 저장",exact:true});
    if(await save.isEnabled()){await save.click();await expect(page.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");}
    await other.close();
  }
});

test("실제 계정 닉네임·이모지 저장·다른 탭·새로고침·기존 metadata 보존과 원래 설정 복원", async ({page,context},info) => {
  await devLogin(page);await page.goto("/settings");await expect(page.getByLabel("닉네임",{exact:true})).toBeVisible();
  const before=await page.evaluate(async()=>{const path="/src/lib/supabase.ts",{supabase}=await import(path);const {data,error}=await supabase.auth.getUser();if(error)throw error;return data.user!.user_metadata;});
  const targetIcon=before.workspace_avatar_id==="cat"?"fox":"cat",targetName="프로필 검증 "+Date.now();
  const other=await context.newPage();await other.goto("/settings");await expect(other.getByLabel("닉네임",{exact:true})).toBeVisible();
  try {
    await page.getByLabel("닉네임",{exact:true}).fill(targetName);await page.getByRole("radio",{name:targetIcon==="cat"?"고양이":"여우",exact:true}).check();
    await page.getByRole("button",{name:"프로필 저장",exact:true}).click();await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");
    await expect(other.getByLabel("닉네임",{exact:true})).toHaveValue(targetName);await expect(other.getByRole("radio",{name:targetIcon==="cat"?"고양이":"여우",exact:true})).toBeChecked();
    await page.reload();await expect(page.getByLabel("닉네임",{exact:true})).toHaveValue(targetName);
    const after=await page.evaluate(async()=>{const path="/src/lib/supabase.ts",{supabase}=await import(path);const {data,error}=await supabase.auth.getUser();if(error)throw error;return data.user!.user_metadata;});
    expect(after).toEqual({...before,workspace_nickname:targetName,workspace_avatar_id:targetIcon});
    await page.screenshot({path:info.outputPath("profile-settings.png"),fullPage:true});
    await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();const popup=page.locator("#nav-profile-options");await expect(popup).toContainText(targetName);await expect(popup).not.toContainText("@");
    await page.screenshot({path:info.outputPath("profile-popover.png")});
  } finally {
    await page.evaluate(async original=>{const path="/src/lib/supabase.ts",{supabase}=await import(path);const {error}=await supabase.auth.updateUser({data:{workspace_nickname:original.workspace_nickname??null,workspace_avatar_id:original.workspace_avatar_id??null}});if(error)throw error;},before);
    await other.close();
  }
});
