import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("웹 원칙 작성→MCP 원문 읽기, MCP 작성→웹 확인", async ({ page }) => {
  await devLogin(page);
  await page.getByRole("link", { name: "원칙", exact: true }).click();
  const title = unique("긴 책 읽기");
  await page.getByRole("button", { name: "원칙 추가" }).click();
  const form = page.getByRole("dialog", { name: "원칙 추가" });
  await form.getByLabel("제목").fill(title);
  await form.getByLabel("요약").fill("300쪽 넘는 책은 휴가에 읽는다.");
  await form.getByLabel("본문").fill("# 독서 근거\n시간을 확보한다.");
  await form.getByLabel("적용 조건").fill("300쪽 초과");
  await form.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("제목")).toHaveValue(title);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const p = await mcp.call("get_principle", { id });
    expect(p.applies_when).toBe("300쪽 초과");
    expect(p.body).toContain("시간을 확보한다.");
    const second = await mcp.call("create_principle", { title: unique("두 번째 원칙"), summary: "예산 승인 후 구매", body: "승인 전에는 보류" });
    await page.goto(`/principles/${second.id}`);
    await expect(page.getByText("승인 전에는 보류")).toBeVisible();
  } finally { await mcp.close(); }
});

test("모든 내용 폼의 취소는 초안을 보호하고 닫은 뒤 초점이 복귀한다", async ({ page }) => {
  await devLogin(page);
  for (const [path, action] of [["/tasks", "할 일 추가"], ["/records", "기록 작성"], ["/principles", "원칙 추가"]]) {
    await page.goto(path);
    const trigger = page.getByRole("button", { name: action, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: action, exact: true });
    await dialog.getByLabel("제목").fill("보존할 초안");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "변경 버리기" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
