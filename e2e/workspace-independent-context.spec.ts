import { expect, type Page } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, workspacePath } from "./support.ts";
import { detailDialog, saveOnce } from "./ui-actions.ts";

const titleInput = (page: Page) => detailDialog(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ });

async function saveTask(page: Page, title: string, workspaceId: string, open = true) {
  if (open) await page.getByRole("button", { name: "할 일 등록", exact: true }).click();
  await titleInput(page).fill(title);
  const response = page.waitForResponse((value) =>
    value.request().method() === "POST" && new URL(value.url()).pathname.endsWith("/api/tasks")
  ).then(async (value) => ({ response: value, body: await value.json() }));
  await saveOnce(page, detailDialog(page), "추가");
  const saved = await response;
  expect(saved.response.ok()).toBe(true);
  expect(saved.response.request().headers()["x-workspace-id"]).toBe(workspaceId);
  await expect(detailDialog(page).getByRole("heading", { name: title, exact: true })).toBeVisible();
  return saved.body as { id: string };
}

test("actual independent contexts: two browser workspaces and a third MCP workspace retain drafts and permissions", async ({ page, context }, info) => {
  await devLogin(page);
  const first = await ownedWorkspace(page);
  const otherPage = await context.newPage();
  await devLogin(otherPage);
  const second = await ownedWorkspace(otherPage);
  const third = await ownedWorkspace(otherPage);
  const mcp = await mcpClient(await mcpTokenViaConsent(otherPage), { workspaceId: third.id });
  const marker = crypto.randomUUID();
  const firstTitle = `첫 공간 ${marker}`, secondTitle = `둘째 공간 ${marker}`, thirdTitle = `MCP 공간 ${marker}`;
  const thirdTask = await mcp.call("create_task", { kind: "once", title: thirdTitle });
  await page.goto(workspacePath(first.id, "/tasks"));
  await otherPage.goto(workspacePath(second.id, "/tasks"));
  const seen: string[] = [];
  for (const [surface, workspace] of [[page, first], [otherPage, second]] as const) {
    surface.on("request", (request) => {
      if (new URL(request.url()).pathname.match(/\/api\/tasks(?:\/|$)/)) {
        seen.push(`${workspace.id}:${request.headers()["x-workspace-id"]}`);
      }
    });
  }
  await page.getByRole("button", { name: "할 일 등록", exact: true }).click();
  await titleInput(page).fill(firstTitle);
  await detailDialog(page).getByLabel("본문", { exact: false }).fill("다른 탭과 MCP가 작업해도 유지할 초안");
  const secondTask = await saveTask(otherPage, secondTitle, second.id);
  expect((await mcp.call("get_task", { id: thirdTask.id })).title).toBe(thirdTitle);
  await expect(titleInput(page)).toHaveValue(firstTitle);
  await expect(detailDialog(page).getByLabel("본문", { exact: false })).toHaveValue("다른 탭과 MCP가 작업해도 유지할 초안");
  const firstTask = await saveTask(page, firstTitle, first.id, false);
  expect((await first.fetch("GET", `/tasks/${secondTask.id}`)).status()).toBe(404);
  expect((await second.fetch("GET", `/tasks/${firstTask.id}`)).status()).toBe(404);
  expect((await first.fetch("GET", `/tasks/${thirdTask.id}`)).status()).toBe(404);
  await expect(mcp.call("get_task", { id: firstTask.id })).rejects.toThrow();
  await expect(page.getByText(secondTitle, { exact: true })).toHaveCount(0);
  await expect(otherPage.getByText(firstTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByText(thirdTitle, { exact: true })).toHaveCount(0);
  const change = async (access: "none" | "write") => {
    await first.setTaskAccess(access);
    const response = page.waitForResponse((value) => value.request().method() === "GET" && new URL(value.url()).pathname.endsWith(`/workspaces/${first.id}`));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect((await response).ok()).toBe(true);
  };
  await change("none");
  await expect(page.getByText(firstTitle, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("이 내용을 읽을 권한이 없습니다.", { exact: true })).toBeVisible();
  await expect(otherPage.getByRole("heading", { name: secondTitle, exact: true })).toBeVisible();
  expect((await mcp.call("get_task", { id: thirdTask.id })).title).toBe(thirdTitle);
  await page.screenshot({ path: info.outputPath("independent-context-permission-none.png"), fullPage: true, animations: "disabled" });
  await change("write");
  await expect(detailDialog(page).getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).pathname).toBe(workspacePath(first.id, `/tasks/${firstTask.id}`));
  expect(seen.length).toBeGreaterThan(0);
  for (const request of seen) {
    const [expected, actual] = request.split(":");
    expect(actual).toBe(expected);
  }
  await page.screenshot({ path: info.outputPath("independent-context-restored.png"), fullPage: true, animations: "disabled" });
});
