import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, unique, workspacePath } from "./support.ts";
import { analyzeAndApply, schemaAnalysisTick } from "./entity-schema-support.ts";
import { closeDetail, detailDialog } from "./ui-actions.ts";
import { disclosureContent } from "./table-actions.ts";
import { chooseSetting } from "./settings-actions.ts";

test("제목 템플릿 저장은 원본과 과거 문맥을 보존하고 목록·연결·상세에 같은 제목을 표시한다", async ({ page }, info) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const client = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const type = await client.call("create_entity_type", { label: unique("제목 템플릿 고객") });
    await workspace.grantKind(type.id);
    const initial = await client.call("get_entity_schema", { type_id: type.id });
    const longPropertyLabel = "확장속성".repeat(19) + "이름값";
    const addition = await client.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: type.schema_version,
      edits: [
        { op: "update_property", key: "prop_2", field: { type: "string", title: "지역", "x-order": 20 }, required: false },
        {
          op: "add_property",
          client_ref: "long_label",
          field: { type: "string", title: longPropertyLabel, "x-order": 30 },
        },
        { op: "add_property", client_ref: "identifier", field: { ...initial.schema.properties.prop_2, "x-order": 40 }, required: true },
        { op: "set_metadata", "x-identity-property": "new_identifier" },
      ],
    });
    await analyzeAndApply(client, type.id, addition.id, addition.version);
    const definition = await client.call("get_entity_schema", { type_id: type.id });
    expect(definition.schema["x-identity-property"]).toBe("prop_4");
    expect(definition.schema.properties.prop_2.type).toBe("string");
    const original = await client.call("create_entity", {
      entity_type_id: type.id,
      schema_version: definition.schema_version,
      properties: { prop_1: "초록상점", prop_2: "서울" },
    });
    const pastTask = await client.call("create_task", {
      kind: "once",
      title: unique("변경 전 연결"),
      entity_ids: [original.id],
    });
    expect(pastTask.entity_context[0].title).toBe("초록상점");
    const pastRecords = await client.call("list_records", { entity_id: original.id, record_kind: "change" });
    const pastRecord = await client.call("get_record", { id: pastRecords.items[0].id });

    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    const settings = page.getByRole("region", { name: "입력 항목", exact: true });
    const editor = settings.getByRole("textbox", { name: "제목 템플릿", exact: true });
    await editor.fill("$prop_2$");
    await settings.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(editor).toHaveText("이름");
    expect((await client.call("get_entity_schema", { type_id: type.id })).schema_version).toBe(
      definition.schema_version,
    );

    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(" - ");
    await chooseSetting(page, settings.getByLabel("제목에 넣을 속성", { exact: true }), "지역");
    await expect(editor).toHaveText("이름 - 지역");
    await page.screenshot({ path: info.outputPath("title-template-edit.png"), fullPage: true });
    await settings.getByRole("button", { name: "변경 검토", exact: true }).click();
    let plan: { id: string } | undefined;
    await expect.poll(async () => {
      const plans = await client.call("list_entity_schema_changes", { type_id: type.id });
      plan = plans.items.find((item: { status: string }) => item.status !== "applied" && item.status !== "cancelled");
      return Boolean(plan);
    }).toBe(true);
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await client.call("get_entity_schema_change", { type_id: type.id, change_id: plan!.id })).status;
    }, { timeout: 30_000 }).toBe("ready");
    await settings.getByRole("button", { name: "변경 적용", exact: true }).click();
    await expect.poll(async () => (await client.call("get_entity_schema", { type_id: type.id })).schema_version)
      .toBe(definition.schema_version + 1);

    const current = await client.call("get_entity", { id: original.id });
    expect(current.title).toBe("초록상점 - 서울");
    expect(current.properties).toEqual({ prop_1: "초록상점", prop_2: "서울", prop_4: original.properties.prop_4 });
    expect(current.version).toBe(original.version);
    expect(current.schema_version).toBe(original.schema_version);
    const found = await client.call("list_entities", {
      entity_type_id: type.id,
      keyword: "초록상점 - 서울",
      sort: "title",
    });
    expect(found.items.map((item: { title: string }) => item.title)).toEqual(["초록상점 - 서울"]);
    const nextTask = await client.call("create_task", {
      kind: "once",
      title: unique("변경 후 연결"),
      entity_ids: [original.id],
    });
    expect(nextTask.entity_context[0].title).toBe("초록상점 - 서울");
    expect((await client.call("get_task", { id: pastTask.id })).entity_context[0].title).toBe("초록상점 - 서울");
    expect((await client.call("get_record", { id: pastRecord.id })).change_metadata).toEqual(
      pastRecord.change_metadata,
    );

    for (const view of ["테이블", "카드"]) {
      await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${type.id}`));
      const list = page.getByRole("region", { name: `${type.label} 목록`, exact: true });
      await list.getByRole("radio", { name: view, exact: true }).click();
      const link = list.getByRole("link", { name: "초록상점 - 서울 상세", exact: true });
      await expect(link).toBeVisible();
      const arrow = list.getByRole("button", { name: "초록상점 - 서울", exact: true });
      await arrow.click();
      const preview = await disclosureContent(page, arrow);
      for (const [label, value] of [["이름", "초록상점"], ["지역", "서울"]]) {
        const term = preview.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) });
        await expect(term.locator("..").getByRole("definition")).toHaveText(value);
      }
      await page.screenshot({ path: info.outputPath(`title-template-${view}.png`), fullPage: true });
      await link.click();
      await expect(detailDialog(page).getByRole("heading", { name: "초록상점 - 서울", exact: true })).toBeVisible();
      await closeDetail(page, "초록상점 - 서울");
    }

    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(" / ");
    await chooseSetting(page, settings.getByLabel("제목에 넣을 속성", { exact: true }), longPropertyLabel);
    const longChip = editor.getByLabel(`변수: ${longPropertyLabel}`, { exact: true });
    await expect(longChip).toHaveText(longPropertyLabel);
    const viewport = page.viewportSize();
    const zoom = await page.evaluate(() => document.documentElement.style.zoom);
    try {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await expect(editor).toBeVisible();
      const bounds = await editor.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      const chip = await longChip.boundingBox();
      expect(chip).not.toBeNull();
      expect(chip!.x).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(chip!.x + chip!.width).toBeLessThanOrEqual(bounds.right + 1);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true);
      await editor.scrollIntoViewIfNeeded();
      await expect(editor).toBeInViewport();
      await page.screenshot({ path: info.outputPath("title-template-long-variable-320-zoom200.png"), fullPage: false });
      await editor.screenshot({ path: info.outputPath("title-template-long-variable-320-zoom200-editor.png") });
    } finally {
      await page.evaluate((value) => {
        document.documentElement.style.zoom = value;
      }, zoom);
      if (viewport) await page.setViewportSize(viewport);
    }
    await settings.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(editor).toHaveText("이름 - 지역");
    expect((await client.call("get_entity_schema", { type_id: type.id })).schema_version).toBe(
      definition.schema_version + 1,
    );
    expect((await client.call("get_entity", { id: original.id })).title).toBe("초록상점 - 서울");
  } finally {
    await client.close();
  }
});
