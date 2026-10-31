import { expect } from "@playwright/test";
import { detailDialog } from "./ui-actions.ts";
import {
  devLogin,
  env,
  mcpClient,
  mcpTokenViaConsent,
  ownedWorkspace,
  test,
  unique,
  workspacePath,
} from "./support.ts";

test("회차 재조회: 실제 API 결과로 복구한 뒤 같은 할 일 회차를 명시 저장한다", async ({ page }, info) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const date = new Date().toISOString().slice(0, 10);
    const task = await mcp.call("create_task", {
      kind: "recurring",
      title: unique("회차 조회 복구"),
      body: "회차 조회와 저장을 구별합니다.",
      recurrence: { freq: "daily", starts_on: date },
      timezone: "UTC",
    });
    const searches: string[] = [];
    let fail = true;
    await page.route(`**/api/tasks/${task.id}/occurrences?**`, (route) => {
      searches.push(new URL(route.request().url()).search);
      return fail
        ? route.fulfill({ status: 503, json: { code: "internal", message: "주입한 조회 실패" } })
        : route.continue();
    });
    await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
    const surface = detailDialog(page),
      section = surface.getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
    await expect(section.getByRole("alert")).toContainText("회차를 불러오지 못했습니다.");
    await expect(section.getByRole("status")).toHaveCount(0);
    fail = false;
    const recovered = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().includes(`/tasks/${task.id}/occurrences?`) &&
      response.status() === 200
    );
    await section.getByRole("button", { name: "회차 다시 조회", exact: true }).click();
    expect((await recovered).ok()).toBe(true);
    await section.getByRole("button", { name: `${date} 회차 기록`, exact: true }).click();
    await surface.getByRole("textbox", { name: /^본문/ }).fill("실제 회차 조회 복구 후 수행 결과");
    await surface.getByRole("button", { name: "기록 저장", exact: true }).click();
    await expect(page).not.toHaveURL(/occurrence=/);
    const results = await mcp.call("list_records", { task_id: task.id, record_kind: "result" });
    expect(results.items).toHaveLength(1);
    expect(results.items[0]).toMatchObject({
      task_id: task.id,
      entity_id: null,
      occurrence_on: date,
      body: "실제 회차 조회 복구 후 수행 결과",
    });
    expect(searches[1]).toBe(searches[0]);
    await info.attach("boundary", {
      body: "초기 GET503만 브라우저에서 주입. 재조회·회차 저장·독립 MCP 읽기는 실제 격리 로컬 API.",
      contentType: "text/plain",
    });
  } finally {
    await mcp.close();
  }
});

test("기록 편집 재조회: 실제 소속 할 일 조회 복구 후 초안만 저장한다", async ({ page }, info) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const task = await mcp.call("create_task", {
      kind: "once",
      title: unique("기록 편집 조회 복구"),
      body: "보존할 할 일 지시",
    });
    const completed = await mcp.call("complete_task", {
      id: task.id,
      expected_version: task.version,
      body: "원래 수행 결과",
    });
    const record = completed.record;
    await page.goto(workspacePath(workspace.id, `/records/${record.id}`));
    const surface = detailDialog(page);
    await expect(surface.getByRole("button", { name: "편집", exact: true })).toBeVisible();
    let fail = true;
    await page.route(
      `**/api/tasks/${task.id}`,
      (route) =>
        fail
          ? route.fulfill({ status: 503, json: { code: "internal", message: "주입한 조회 실패" } })
          : route.continue(),
    );
    await surface.getByRole("button", { name: "편집", exact: true }).click();
    const target = surface.getByRole("region", { name: "할 일 (1개)", exact: true }),
      body = surface.getByRole("textbox", { name: /^본문/ });
    await body.fill("조회 복구와 독립적인 결과 정정");
    await expect(target).toContainText("연결된 할 일을 불러오지 못했습니다.");
    const url = page.url();
    fail = false;
    const recovered = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url() === `${env.VITE_API_URL}/tasks/${task.id}` &&
      response.status() === 200
    );
    await target.getByRole("button", { name: "할 일 다시 조회", exact: true }).click();
    expect((await recovered).ok()).toBe(true);
    await expect(target).toContainText(task.title);
    await expect(target).toContainText("완료");
    await expect(body).toHaveValue("조회 복구와 독립적인 결과 정정");
    await expect(page).toHaveURL(url);
    const before = await mcp.call("get_record", { id: record.id });
    expect(before.body).toBe("원래 수행 결과");
    const written = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url() === `${env.VITE_API_URL}/records/${record.id}`
    );
    await surface.getByRole("button", { name: "저장", exact: true }).click();
    const response = await written;
    expect(response.ok()).toBe(true);
    const input = response.request().postDataJSON();
    expect(input).not.toHaveProperty("task_id");
    expect(input).not.toHaveProperty("entity_id");
    await expect(surface.getByRole("textbox", { name: /^본문/ })).toHaveCount(0);
    const saved = await mcp.call("get_record", { id: record.id });
    expect(saved).toMatchObject({
      body: "조회 복구와 독립적인 결과 정정",
      task_id: task.id,
      entity_id: null,
      record_kind: "result",
    });
    expect((await mcp.call("get_task", { id: task.id })).body).toBe(task.body);
    await info.attach("boundary", {
      body: "편집 중 부모 GET503만 주입. 재조회·명시 PATCH·독립 MCP 읽기는 실제 격리 로컬 API.",
      contentType: "text/plain",
    });
  } finally {
    await mcp.close();
  }
});
