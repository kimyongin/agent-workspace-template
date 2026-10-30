import { businessRows } from "./table-actions.ts";
import { chooseSetting } from "./settings-actions.ts";
import { openMainNavigation } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { test, devLogin, ownedWorkspace, workspacePath } from "./support.ts";
// Serial real Auth metadata round trip, run by the integration owner.
test("personal navigation partial save survives reload and login without changing other profile metadata", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const read = () => page.evaluate(async () => {
    const path = "/src/lib/supabase.ts", { supabase } = await import(path);
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user!.user_metadata as Record<string, unknown>;
  });
  const before = await read();
  const restoreEmpty = await workspace.preservePreferences({ ...before, workspace_navigation: { version: 1, refs: [] } });
  let restoreTarget: (() => Promise<void>) | undefined;
  let bodyFailed = false;
  try {
    await page.goto(workspacePath(workspace.id, "/settings"));
    const list = page.getByRole("table", { name: "선택한 바로가기" });
    await expect(list).toBeVisible();
    while (await businessRows(list).count()) await list.getByRole("button", { name: /숨기기$/ }).first().click();
    const save = page.getByRole("button", { name: "메뉴 바로가기 저장" });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
    }
    const cleared = await read();
    restoreTarget = await workspace.preservePreferences({ ...cleared, workspace_navigation: {
      version: 1, refs: [{ kind: "builtin", id: "records" }, { kind: "builtin", id: "tasks" }],
    } });
    for (const label of ["기록", "할 일"]) {
      await chooseSetting(page, page.getByRole("combobox", { name: "추가할 메뉴", exact: true }), label);
    }
    await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
    await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
    const after = await read();
    expect(after.workspace_navigation).toEqual({
      version: 1,
      refs: [{ kind: "builtin", id: "records" }, { kind: "builtin", id: "tasks" }],
    });
    const { workspace_navigation: _old, ...oldOther } = before;
    const { workspace_navigation: _next, ...newOther } = after;
    expect(newOther).toEqual(oldOther);
    await page.reload();
    await openMainNavigation(page);
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).locator('[data-slot="sidebar-group"]').filter({ has: page.getByText("바로가기", { exact: true }) }).getByRole("link"))
      .toHaveText(["기록", "할 일"]);
    await openMainNavigation(page);
    await page.getByRole("link", { name: "로그아웃", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    await devLogin(page);
    await page.goto(workspacePath(workspace.id, "/tasks"));
    await openMainNavigation(page);
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).locator('[data-slot="sidebar-group"]').filter({ has: page.getByText("바로가기", { exact: true }) }).getByRole("link"))
      .toHaveText(["기록", "할 일"]);
  } catch (cause) {
    bodyFailed = true;
    throw cause;
  } finally {
    try {
      // Unwind only exact captured states, in reverse write order; concurrent metadata is never overwritten.
      if (restoreTarget) await restoreTarget();
      await restoreEmpty();
    } catch (cause) {
      if (!bodyFailed) throw cause;
      // Preserve the original assertion and separately flag incomplete restoration, without printing Auth payloads.
      test.info().annotations.push({
        type: "cleanup-failed",
        description: "Navigation restoration also failed; inspect the protected trace.",
      });
      console.error(
        "Navigation restoration also failed; the original test error is preserved. Inspect the protected trace.",
      );
    }
  }
});
