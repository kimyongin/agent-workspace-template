import { expect } from "@playwright/test";
import { devLogin, ownedWorkspace, test, workspacePath } from "./support.ts";
import { openMainNavigation } from "./ui-actions.ts";

test("실제 공간 목록의 조회 실패를 같은 메뉴에서 복구하고 명시 선택한다", async ({ page }, info) => {
  await devLogin(page);
  const origin = await ownedWorkspace(page), target = await ownedWorkspace(page);
  let fail = true;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/functions/v1/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(request.method());
    }
  });
  await page.route(
    "**/functions/v1/api/workspaces",
    (route) =>
      fail
        ? route.fulfill({ status: 503, json: { code: "unavailable", message: "일시적인 공간 목록 조회 실패" } })
        : route.fallback(),
  );
  await page.goto(workspacePath(origin.id, "/tasks"));
  await openMainNavigation(page);
  await page.getByRole("button", { name: "공간 선택", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "목록 다시 불러오기", exact: true })).toBeVisible();
  fail = false;
  const response = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/api/workspaces")
  );
  await page.getByRole("menuitem", { name: "목록 다시 불러오기", exact: true }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  const fresh = await received.json();
  await received.finished();
  const destination = fresh.items.find((item: { id: string; name: string }) => item.id === target.id);
  expect(destination).toBeTruthy();
  const menu = page.getByRole("menu");
  await expect(menu).toHaveAttribute("data-state", "open");
  await page.screenshot({ path: info.outputPath("actual-workspace-menu-recovered.png"), animations: "disabled" });
  await menu.getByRole("menuitem", { name: destination.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${target.id}/tasks$`));
  await expect(page.getByRole("heading", { name: "할 일", level: 1, exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
