import { expect, test } from "@playwright/test";
import { devLogin, env, unique } from "./support.ts";
import { beginTabAction } from "./ui-actions.ts";

test("설정 템플릿 오류·변수 삽입과 실제 변경 확인·취소·수정 메모 보존·고정 재시도", async ({page}) => {
  await devLogin(page);
  const login = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY},data:{email:env.DEV_USER_A_EMAIL,password:env.DEV_USER_A_PASSWORD}});
  const token = (await login.json()).access_token;
  const api = async(method:string,path:string,data?:unknown) => {
    const response = await page.request.fetch(`${env.VITE_API_URL}${path}`,{method,headers:{authorization:`Bearer ${token}`},data});
    const text = await response.text();
    expect(response.ok(), `${method} ${path}: ${response.status()} ${text}`).toBeTruthy(); return response.status() === 204 ? null : JSON.parse(text);
  };
  const saved = await api("GET","/settings/business");
  const tag = await api("POST","/tags",{id:crypto.randomUUID(),scope:"record",name:unique("템플릿")});
  let taskId:string|undefined;
  try {
    await page.goto("/settings");
    const form = page.getByRole("form",{name:"변경 기록 기본값"});
    await expect(form.getByLabel("메모 템플릿")).toBeVisible();
    await form.getByLabel("메모 템플릿").fill("앞 ${엔터티.이전.속성2$}");
    await form.getByRole("button",{name:"기록 기본값 저장"}).click();
    await expect(form).toContainText("3번째 문자");
    await expect(form.getByLabel("메모 템플릿")).toHaveValue("앞 ${엔터티.이전.속성2$}");
    await form.getByLabel("액션",{exact:true}).selectOption("update");
    await form.getByLabel("메모 템플릿").fill("");
    await form.getByLabel("변수 삽입").selectOption("엔터티.이전.속성2");
    await expect(form.getByLabel("메모 템플릿")).toHaveValue("$엔터티.이전.속성2$");
    await form.getByLabel("메모 템플릿").fill("${엔터티.이전.속성2$} → ${엔터티.이후.속성2$}");
    await expect(form.getByText("미리보기 예시 값 편집",{exact:true})).toHaveCount(0);
    await expect(form.locator("output")).toHaveCount(0);
    // Clear the invalid create slot before saving another action.
    await form.getByLabel("액션",{exact:true}).selectOption("create");
    await form.getByLabel("메모 템플릿").fill("");
    await form.getByLabel("모델",{exact:true}).selectOption("task");
    await form.getByLabel("메모 템플릿").fill("${대상$} 준비 ${액션$}");
    await form.getByRole("button",{name:tag.name,exact:true}).click();
    await form.getByRole("button",{name:"기록 기본값 저장"}).click();
    await expect(form).toContainText("기록 기본값을 저장했습니다.");
    await page.goto("/tasks");
    const preparedIds:string[]=[];
    page.on("request", request => {if(request.url().endsWith("/records/prepare") && request.method()==="POST"){const input=request.postDataJSON();if(input.model==="task"&&input.action==="create")preparedIds.push(input.input.id);}});
    await beginTabAction(page,"할 일 추가");
    const dialog=page.getByRole("dialog",{name:"할 일 추가",exact:true});
    const title=unique("재시도 템플릿");
    await dialog.getByRole("textbox",{name:/^제목/}).fill(title);
    await dialog.getByRole("button",{name:"추가",exact:true}).click();
    const confirmation=page.locator("dialog.modal-action[open]");
    await expect(confirmation.getByLabel("기록 메모",{exact:true})).toHaveValue(`${title} 준비 등록`);
    await expect(confirmation.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","true");
    await confirmation.getByLabel("기록 메모",{exact:true}).fill("  내 메모\n");
    await confirmation.getByRole("button",{name:"태그 선택 해제",exact:true}).click();
    await confirmation.getByRole("button",{name:"취소",exact:true}).click();
    await dialog.getByRole("button",{name:"추가",exact:true}).click();
    await expect(confirmation.getByLabel("기록 메모",{exact:true})).toHaveValue("  내 메모\n");
    await expect(confirmation.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","false");
    await expect(confirmation.getByRole("button",{name:"템플릿 다시 적용",exact:true})).toHaveCount(0);
    const requests:unknown[]=[];
    await page.route("**/api/tasks",async route=>{
      if(route.request().method()!=="POST") return route.continue();
      requests.push(route.request().postDataJSON());
      if(requests.length===1) return route.abort("failed");
      return route.continue();
    });
    await confirmation.getByRole("button",{name:"등록하고 저장",exact:true}).click();
    await expect(confirmation.getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeVisible();
    await expect(confirmation.getByLabel("기록 메모",{exact:true})).toBeDisabled();
    await expect(confirmation.getByRole("button",{name:"템플릿 다시 적용",exact:true})).toHaveCount(0);
    const current=await api("GET","/settings/business");
    await api("PATCH","/settings/business",{expected_version:current.versions.record_templates,id: "record_templates", value: {task:{create:{memo:"나중에 바뀐 기본값",tag_ids:[]}}}});
    await confirmation.getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();
    await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    taskId=(requests[0] as {id:string}).id;
    expect(preparedIds.length).toBeGreaterThan(0);expect(new Set(preparedIds)).toEqual(new Set([taskId]));
    const records=await api("GET","/records?record_kind=change&limit=100");
    const record=records.items.find((value:{change?:{target_id:string;action:string}})=>value.change?.target_id===taskId&&value.change.action==="create");
    expect(record.body).toBe("  내 메모\n"); expect(record.tag_ids).toEqual([]);
  } finally {
    if(taskId){const task=await api("GET",`/tasks/${taskId}`);await api("POST",`/tasks/${taskId}/delete`,{expected_version:task.version,change_tag_ids:[]});}
    const current=await api("GET","/settings/business");await api("PATCH","/settings/business",{expected_version:current.versions.record_templates,id: "record_templates", value: saved.settings.record_templates??{}});
    await api("DELETE",`/tags/${tag.id}?expected_version=${tag.version}`);
  }
});
