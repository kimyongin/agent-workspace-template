import { detailDialog, executionDialog } from "./ui-actions.ts";
import { generateDataId } from "../supabase/functions/_shared/contracts/data-id.ts";
import { createFixtureEntity } from "./entity-schema-support.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { saveOnce, openListDetail, openTabFilters, chooseTag, applyTabFilters } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { test, devLogin, env, mcpClient, mcpTokenViaConsent, unique, ownedFixtureSeed, ownedWorkspace, workspacePath} from "./support.ts";

for (
  const [kind, path, label, editLabel] of [
    ["task", "tasks", "할 일", "할 일 편집"],
    ["record", "records", "기록", "기록 편집"],
  ] as const
) {
  test(`${label} 추가 페이지의 상세·편집·뒤로가기·새로고침·삭제가 목록 문맥과 초점을 복원한다`, async ({ page, isMobile }) => {
    // Native-dialog list restoration; retained desktop panels have their own workspace suite.
    if (!isMobile) await page.setViewportSize({width:1024,height:720});
    await devLogin(page);
  const workspace = await ownedWorkspace(page);
    const token = await mcpTokenViaConsent(page);
    const mcp = await mcpClient(token, { workspaceId: workspace.id });
    const tag = await mcp.call("create_tag", { scope:kind, name: unique("활동 왕복").slice(0, 30) });
    const emptyTag = await mcp.call("create_tag", { scope:kind, name: unique("빈 활동 조건").slice(0, 30) });
    const entity = await createFixtureEntity(mcp, workspace, { prop_1: unique("활동 문맥"), prop_2: 0 });
    const title = unique(`${label} 복원 대상`);
    const date = new Date().toISOString().slice(0, 10);
    const parent = kind === "record" ? await mcp.call("create_task", {
      kind: "recurring", title: unique("결과의 할 일"), body: "자료 연결과 결과 소속을 구분합니다.",
      entity_ids: [entity.id], recurrence: { freq: "daily", starts_on: date }, timezone: "UTC",
    }) : null;
    const create = async (title: string) => {
      const item = kind === "task"
        ? await mcp.call("create_task", {kind:"once", title, body:title, entity_ids:[entity.id]})
        : await mcp.call("record_occurrence", {task_id:parent!.id,date,body:title});
      await mcp.call("set_tag_connections", {target_kind:kind,target_id:item.id,expected_version:item.version,tag_ids:[tag.id]});
      return mcp.call(`get_${kind}`, {id:item.id});
    };
    const editLoadedDetail = async (detailPath: string, heading: string) => {
      const viewer = detailDialog(page);
      // Route and target rendering must agree before invoking an action from
      // the retained previous viewer during a related-detail transition.
      await expect.poll(() => new URL(page.url()).pathname).toBe(workspacePath(workspace.id, detailPath));
      await expect(viewer.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const freshRead = page.waitForRequest(request => request.method() === "GET" && request.url() === `${env.VITE_API_URL}${detailPath}`);
      await viewer.getByRole("button", { name: "편집", exact: true }).click();
      const loaded = await (await freshRead).response();
      expect(loaded?.status()).toBe(200);
      await loaded!.finished();
      await expect(viewer.getByRole("button", { name: "저장", exact: true })).toBeVisible();
    };
    // Filler rows establish pagination only. Clone the API-created target's real
    // context in one guarded, explicitly scoped seed transaction.
    const seedPage = async (targetId: string, count: number, label: string) => {
      const ids = Array.from({ length: count }, () => generateDataId());
      const prefix = unique(label);
      await ownedFixtureSeed(workspace.id, [{ target_kind: "tasks", target_id: "*", access: "write" }, ...(kind === "task" ? [{ target_kind: "entity_type" as const, target_id: entity.entity_type_id as string, access: "read" as const }] : [])], async sql => {
        const inserted = kind === "task"
          ? await sql`
            insert into app.tasks (id,workspace_id,kind,title,body,status,entity_ids,entity_context,created_at,updated_at)
            select seed.id,source.workspace_id,source.kind,${prefix} || ' ' || seed.n,
              ${prefix} || ' ' || seed.n,source.status,source.entity_ids,source.entity_context,clock_timestamp(),clock_timestamp()
            from app.tasks source cross join unnest(${ids}::text[]) with ordinality seed(id,n)
            where source.workspace_id=${workspace.id} and source.id=${targetId}
            returning id`
          : await sql`
            insert into app.records (id,workspace_id,body,record_kind,task_id,entity_id,occurrence_on,occurred_at,created_at,updated_at)
            select seed.id,source.workspace_id,${prefix} || ' ' || seed.n,source.record_kind,
              source.task_id,source.entity_id,source.occurrence_on,clock_timestamp(),clock_timestamp(),clock_timestamp()
            from app.records source cross join unnest(${ids}::text[]) with ordinality seed(id,n)
            where source.workspace_id=${workspace.id} and source.id=${targetId}
            returning id`;
        expect(inserted).toHaveLength(count);
        if (kind === "task") await sql`
          insert into app.task_tags (task_id,tag_id,workspace_id)
          select id,${tag.id},workspace_id from app.tasks where workspace_id=${workspace.id} and id=any(${ids}::text[])`;
        else await sql`
          insert into app.record_tags (record_id,tag_id,workspace_id)
          select id,${tag.id},workspace_id from app.records where workspace_id=${workspace.id} and id=any(${ids}::text[])`;
      });
    };
    try {
      const target = await create(title);
      await seedPage(target.id, 41, "앞선 항목");
      const listPath = workspacePath(workspace.id, `/${path}?tag_id=${tag.id}${kind==="record"?"&record_kind=result":""}`);
      await page.goto(listPath);
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(20);
      const requests: (string | null)[] = [];
      let failedCursor: string | null = null;
      let releaseRetry!: () => void;
      const retryHeld = new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });
      await page.route(`**/api/${path}?**`, async (route) => {
        const cursor = new URL(route.request().url()).searchParams.get("cursor");
        requests.push(cursor);
        if (cursor && !failedCursor) {
          failedCursor = cursor;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ code: "internal", message: "temporary list failure" }),
          });
        } else {
          if (cursor) await retryHeld;
          await route.continue();
        }
      });
      const more = page.locator(`#activity-${path}-page-control`);
      await more.click();
      const retry = page.getByRole("button", { name: "다시 시도", exact: true });
      await expect(retry).toBeVisible();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(20);
      await retry.scrollIntoViewIfNeeded();
      await retry.focus();
      const scrollBefore = await page.getByRole("main").evaluate(el => el.scrollTop);
      const readingRow = page.locator(`#${await page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]").last().getAttribute("id")}`);
      await expect(readingRow).toBeInViewport();
      const readingY = (await readingRow.boundingBox())!.y;
      if (kind === "task") await page.keyboard.press("Enter");
      else await retry.click();
      const control = page.locator(`#activity-${path}-page-control`);
      await expect.poll(() => requests.length).toBe(2);
      expect(requests).toEqual([failedCursor, failedCursor]);
      expect(failedCursor).toBeTruthy();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(20);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      expect(await page.getByRole("main").evaluate(el => el.scrollTop)).toBe(scrollBefore);
      expect((await readingRow.boundingBox())!.y).toBeCloseTo(readingY, 1);
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(2);
      releaseRetry();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(40);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-disabled", "false");
      expect(await page.getByRole("main").evaluate(el => el.scrollTop)).toBe(scrollBefore);
      await expect(readingRow).toBeInViewport();
      expect((await readingRow.boundingBox())!.y).toBeCloseTo(readingY, 1);
      await control.scrollIntoViewIfNeeded();
      const lastRow = page.locator(`#${await page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]").last().getAttribute("id")}`);
      await lastRow.scrollIntoViewIfNeeded();
      await expect(lastRow).toBeInViewport();
      const lastY = (await lastRow.boundingBox())!.y;
      const lastScroll = await page.getByRole("main").evaluate(el => el.scrollTop);
      await control.click();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(42);
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-disabled", "true");
      expect(await page.getByRole("main").evaluate(el => el.scrollTop)).toBe(lastScroll);
      await expect(lastRow).toBeInViewport();
      expect((await lastRow.boundingBox())!.y).toBeCloseTo(lastY, 1);
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(3);
      await page.unroute(`**/api/${path}?**`);
      let link = page.getByRole("button", { name: title, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(link).toHaveAttribute("aria-expanded","true");
      await openListDetail(page,title);
      await expect(page.getByRole("heading", { name: kind === "record" ? "기록" : title, exact: true })).toBeVisible();
      const view=detailDialog(page);
      const related = kind === "task" ? entity : parent!;
      const relatedPath = kind === "task" ? `/entities/${encodeURIComponent(entity.id)}` : `/tasks/${parent!.id}`;
      const initialDetail=page.url();
      const relation=view.getByRole("region", {name:kind === "task" ? /^연결된 자료/ : /^할 일 \(/});
      const relatedToggle=relation.getByRole("button", {name:related.title,exact:true});
      await relatedToggle.click();
      await expect(relatedToggle).toHaveAttribute("aria-expanded","true");
      await expect(page).toHaveURL(initialDetail);
      const relatedEdit=relation.getByRole("link", {name:related.title+" 상세",exact:true});
      await relatedEdit.click();
      await editLoadedDetail(relatedPath,related.title);
      await expect(view.getByLabel("제목",{exact:false})).toHaveValue(related.title);
      await view.getByRole("button",{name:"취소",exact:true}).click();
      await view.getByRole("button",{name:/^이전:/}).click();
      await expect(page).toHaveURL(initialDetail);
      await expect(relatedEdit).toBeFocused();
      await editLoadedDetail(`/${path}/${target.id}`,kind === "record" ? "기록" : title);const dialog=page.getByRole("dialog",{name:editLabel,exact:true});
      await dialog.getByLabel("본문").fill("닫기 취소 뒤 보존할 초안");await dialog.getByRole("button",{name:"닫기",exact:true}).click();
      const discard=page.getByRole("alertdialog",{name:"변경을 버릴까요?",exact:true});await discard.getByRole("button",{name:"취소",exact:true}).click();await expect(dialog.getByLabel("본문")).toHaveValue("닫기 취소 뒤 보존할 초안");
      expect((await mcp.call(`get_${kind}`,{id:target.id})).body).toBe(target.body);await dialog.getByLabel("본문").fill(target.body);await dialog.getByRole("button",{name:"닫기",exact:true}).click();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(42);
      await expect(link).toBeFocused();await openListDetail(page,await link.innerText());
      // Enter the rendered detail before simulating external rows and returning.
      await expect(view.getByRole("heading", { name: kind === "record" ? "기록" : title, exact: true })).toBeVisible();
      await seedPage(target.id, 21, "상세 중 추가");
      await page.goBack();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(63);
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await openTabFilters(page);await expect(page.getByRole("button", { name: `${tag.name} 선택 해제`, exact: true })).toHaveCount(1);
      await page.reload();
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(63);
      await expect(link).toBeFocused();
      await openListDetail(page,await link.innerText());
      await editLoadedDetail(`/${path}/${target.id}`,kind === "record" ? "기록" : title);
      await dialog.getByLabel("본문").fill("수정한 근거");
      if(kind==="task")await fillChangeMemo(page,dialog,"판단 근거 정정");
      await saveOnce(page, dialog);
      await expect(dialog).not.toBeVisible();
      if(kind==="record")link=page.getByRole("button",{name:"수정한 근거",exact:true});
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await openListDetail(page,await link.innerText());
      await editLoadedDetail(`/${path}/${target.id}`,kind === "record" ? "기록" : title);
      await page.getByRole("button", { name: "삭제", exact: true }).click();
      await saveOnce(page,executionDialog(page),"삭제 확인");
      await expect(link).toHaveCount(0);
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(62);
      await expect(page.getByRole("heading", { name: label, level:1, exact: true })).toBeFocused();
      await expect(page.locator(`#activity-${path}-page-control`)).toHaveCount(0);
      await openTabFilters(page);await chooseTag(page,page,tag.name,false);await chooseTag(page,page,emptyTag.name);await applyTabFilters(page);
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("");
      expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
      expect(new URL(page.url()).searchParams.has("scroll")).toBe(false);
      // An independent tag unlink removes the saved target from this filter
      // without changing its content or immutable record parent.
      const leaving = await create(unique("연결 조건 이탈"));
      await page.goto(listPath);
      const leavingLink = page.getByRole("button", { name: kind === "record" ? leaving.body : leaving.title, exact: true });
      await openListDetail(page,await leavingLink.innerText());
      await mcp.call("set_tag_connections", {target_kind:kind,target_id:leaving.id,expected_version:leaving.version,tag_ids:[]});
      await page.goBack();
      await expect(leavingLink).toHaveCount(0);
      await expect(page.getByRole("heading", { name: label, level:1, exact: true })).toBeFocused();
      await openTabFilters(page);await expect(page.getByRole("button", { name: `${tag.name} 선택 해제`, exact: true })).toHaveCount(1);
    } finally {
      // The automatic owned fixture closes UI first and removes these exact IDs,
      // dependent change records and queue state after the business assertions.
      await mcp.close();
    }
  });
}
