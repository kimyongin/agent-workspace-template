import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { discardEditor, fillChangeMemo } from "./ui-actions.ts";

test("연결된 자료: 웹 추가→상대 상세→해제→새로고침과 편집 초안·메모·키보드 보존", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("연결 시험"),
      icon_id: "leaf",
      representative_label: "이름",
    });
    const otherType = await mcp.call("create_entity_type", {
      label: unique("상대 종류"),
      icon_id: "box",
      representative_label: "이름",
    });
    const x = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 1,
      properties: { prop_1: unique("원점") },
    });
    const y = await mcp.call("create_entity", {
      entity_type_id: otherType.id,
      schema_version: 1,
      properties: { prop_1: unique("상대") },
    });
    const path = (id: string) => `/entities/${encodeURIComponent(id)}`;
    await page.goto(path(x.id));
    const detail = page.locator("dialog.modal:not(.modal-confirm)[open]:visible");
    const links = detail.getByRole("region", { name: "연결된 자료", exact: true });
    await expect(links.getByRole("heading", { name: "연결된 자료", exact: true })).toBeVisible();
    await links.getByRole("button", { name: "자료 연결", exact: true }).click();
    await links.getByLabel("자료 종류", { exact: true }).selectOption(otherType.id);
    const search = links.getByRole("searchbox", { name: "자료 제목 검색", exact: true });
    await search.fill(y.title);
    await expect(links.getByText(otherType.label, { exact: false }).last()).toBeVisible();
    await links.getByRole("button", { name: `${y.title} 연결`, exact: true }).click();
    const confirmation = page.locator("dialog.modal-action[open]:visible");
    const memo = confirmation.getByLabel("기록 메모", { exact: true });
    await memo.fill("관계를 설명하는 사용자 메모");
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(search).toHaveValue(y.title);
    await expect(links.getByLabel("자료 종류", { exact: true })).toHaveValue(otherType.id);
    await links.getByRole("button", { name: `${y.title} 연결`, exact: true }).click();
    await confirmation.getByLabel("기록 메모", { exact: true }).fill("관계 검증");
    await confirmation.getByRole("button", { name: "연결하고 저장", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(links.getByRole("button", { name: y.title, exact: true })).toBeVisible();
    expect((await mcp.call("list_entity_links", { id: y.id })).items.map((e: { id: string }) => e.id)).toEqual([x.id]);
    await links.getByRole("button", { name: y.title, exact: true }).click();
    await links.getByRole("link", { name: y.title + " 상세", exact: true }).click();
    await expect(links.getByRole("button", { name: x.title, exact: true })).toBeVisible();
    await links.getByRole("button", { name: x.title, exact: true }).click();
    await links.getByRole("button", { name: `${x.title} 연결 해제`, exact: true }).click();
    await confirmation.getByRole("button", { name: "해제하고 저장", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await page.reload();
    await expect(links.getByText("연결된 자료가 없습니다.", { exact: true })).toBeVisible();
    expect((await mcp.call("list_entity_links", { id: x.id })).items).toEqual([]);
    await detail.getByRole("button", { name: "편집", exact: true }).click();
    await expect(detail.getByRole("button", { name: "저장", exact: true })).toBeVisible();
    const draft = detail.getByLabel("이름", { exact: false });
    await draft.fill("잃지 않을 초안");
    await fillChangeMemo(page, detail, "사용자 기록 초안");
    await expect(confirmation.getByLabel("기록 메모", { exact: true })).toHaveValue(
      "사용자 기록 초안",
    );
    await page.keyboard.press("Escape");
    await expect(draft).toHaveValue("잃지 않을 초안");
    await discardEditor(page);
  } finally {
    await mcp.close();
  }
});
