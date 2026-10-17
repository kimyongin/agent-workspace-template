import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";

test("정의한 관계만 표시하고 실제 101개 작성 연결을 더 보기로 모두 조회한다", async ({ page }, info) => {
  test.setTimeout(180_000);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", { label: unique("정의 관계") });
    const origin = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 1,
      properties: { prop_1: "관계 원점" },
    });
    const path = `/entities/${encodeURIComponent(origin.id)}`;
    await page.goto(path);
    const detail = page.locator("dialog.modal:not(.modal-confirm)[open]:visible");
    await expect(detail.getByRole("region", { name: /^연결된 자료/ })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "자료 연결", exact: true })).toHaveCount(0);
    const def = await mcp.call("create_entity_relation_definition", {
      ends: [
        { type_id: type.id, label: "구성 자료", cardinality: "many" },
        { type_id: type.id, label: "사용 원점", cardinality: "many" },
      ],
    });
    const ids: string[] = [];
    for (let n = 0; n < 101; n++) {
      const result = await mcp.call("create_and_link_entity", {
        definition_id: def.id,
        side: 0,
        origin_id: origin.id,
        expected_definition_version: 1,
        expected_version: 1 + n,
        previous_other_id: null,
        expected_previous_version: null,
        entity: {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: `구성 ${String(n + 1).padStart(3, "0")}` },
        },
      });
      ids.push(result.entity.id);
    }
    const location = { definition_id: def.id, side: 0, origin_id: origin.id };
    const first = await mcp.call("list_entity_relation_links", { ...location, limit: 100 });
    const last = await mcp.call("list_entity_relation_links", { ...location, limit: 100, cursor: first.next_cursor });
    expect(first.items).toHaveLength(100);
    expect(last.items).toHaveLength(1);
    expect(new Set([...first.items, ...last.items].map((v) => v.id))).toEqual(new Set(ids));
    await page.reload();
    const section = detail.getByLabel("구성 자료 관계", { exact: true });
    await expect(section.getByRole("heading", { name: /^구성 자료/ })).toBeVisible();
    // Use the existing pagination action; its visible state is the public UI boundary.
    for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
      await section.getByRole("button", { name: "더 보기", exact: true }).click();
    }
    await expect(section.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
    for (const title of ["구성 001", "구성 101"]) {
      await expect(section.getByRole("button", { name: title, exact: true })).toBeVisible();
    }
    await expect(section.getByRole("listitem")).toHaveCount(101);
    await page.screenshot({ path: info.outputPath("configured-relations-101.png"), fullPage: true });
  } finally {
    await mcp.close();
  }
});
