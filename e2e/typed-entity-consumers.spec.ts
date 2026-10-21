import { ownedWorkspace, workspacePath } from "./support.ts";
import { chooseSetting } from "./settings-actions.ts";
import { expect } from "@playwright/test";
import {
  devLogin,
  mcpClient,
  mcpTokenViaConsent,
  test,
  unique,
} from "./support.ts";
import { analyzeAndApply } from "./entity-schema-support.ts";
import { openTabFilters } from "./ui-actions.ts";
test("타입별 목록·AND 필터·업무 문맥·템플릿은 현재 정의를 사용하며 과거 사실을 보존한다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), {
    workspaceId: workspace.id,
  });
  const previous = await mcp.call("get_business_settings", {
    id: "record_templates",
  });
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("조회 자료"),
      initial_property_label: "품명",
    });
    await workspace.grantKind(type.id);
    const other = await mcp.call("create_entity_type", {
      label: unique("별도 자료"),
      initial_property_label: "이름",
    });
    await workspace.grantKind(other.id);
    const additions = [
      {
        op: "add_property",
        client_ref: "count",
        field: {
          "x-order": 20,
          type: ["integer", "null"],
          title: "수량",
          minimum: 0,
          maximum: 1000,
        },
      },
      {
        op: "add_property",
        client_ref: "day",
        field: {
          "x-order": 30,
          type: ["string", "null"],
          format: "date",
          title: "날짜",
        },
      },
      {
        op: "add_property",
        client_ref: "checked",
        field: { "x-order": 40, type: ["boolean", "null"], title: "검사" },
      },
    ];
    let change = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 1,
      edits: additions,
    });
    change = await mcp.call("update_entity_schema_change", {
      type_id: type.id,
      change_id: change.id,
      expected_schema_version: 1,
      expected_change_version: change.version,
      edits: additions.map((edit) => ({
        ...edit,
        field: { ...edit.field},
      })),
    });
    await analyzeAndApply(mcp, type.id, change.id, change.version);
    const first = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 2,
      properties: {
        prop_1: unique("零資料"),
        prop_2: 0,
        prop_3: "2024-02-29",
        prop_4: false,
      },
    });
    const second = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 2,
      properties: {
        prop_1: unique("二資料"),
        prop_2: 2,
        prop_3: "2025-01-01",
        prop_4: true,
      },
    });
    const separate = await mcp.call("create_entity", {
      entity_type_id: other.id,
      schema_version: 1,
      properties: { prop_1: unique("別資料") },
    });
    const task = await mcp.call("create_task", {
      kind: "once",
      title: unique("型別業務"),
      entity_ids: [first.id, separate.id],
    });
    const { record } = await mcp.call("complete_task", {
      id: task.id,
      expected_version: task.version,
      body: "過去の本文",
    });
    expect(
      task.entity_context.find((context: { id: string }) =>
        context.id === first.id
      ).type.label,
    ).toBe(type.label);
    await page.goto(
      workspacePath(
        workspace.id,
        `/entities?entity_type_id=${type.id}&view=table`,
      ),
    );
    await expect(page.getByRole("columnheader", { name: "제목", exact: true }))
      .toBeVisible();
    await openTabFilters(page);
    await page.getByRole("button", { name: "속성 조건 추가", exact: true })
      .click();
    await page.getByLabel("조건 1 속성", { exact: true }).selectOption(
      "prop_2",
    );
    await page.getByLabel("조건 1 비교", { exact: true }).selectOption("gte");
    await page.getByLabel("조건 1 값", { exact: true }).fill("0");
    await page.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(page.getByRole("button", { name: first.title, exact: true }))
      .toBeVisible();
    await expect(page.getByRole("button", { name: second.title, exact: true }))
      .toBeVisible();
    await page.goto(workspacePath(workspace.id, "/settings/records"));
    await chooseSetting(
      page,
      page.getByLabel("대상", { exact: true }),
      type.label,
    );
    const template = page.getByRole("form", { name: "기록 자동 완성" });
    await chooseSetting(
      page,
      template.getByLabel("액션", { exact: true }),
      "수정",
    );
    await template.getByLabel("메모 템플릿", { exact: true }).fill(
      "値 $엔터티.이후.prop_2$ / $엔터티.이후.prop_4$",
    );
    await template.getByRole("button", {
      name: "기록 자동 완성 저장",
      exact: true,
    }).click();
    await expect(
      template.getByRole("status").filter({
        hasText: "기록 자동 완성을 저장했습니다.",
      }),
    ).toHaveText(
      "기록 자동 완성을 저장했습니다.",
    );
    const updated = await mcp.call("update_entity", {
      id: second.id,
      expected_version: second.version,
      schema_version: 2,
      properties: { prop_2: 0, prop_4: false },
    });
    expect(updated.properties.prop_2).toBe(0);
    const logs = await mcp.call("list_records", {
      entity_id: second.id,
      record_kind: "change",
    });
    expect(
      logs.items.some((value: { body: string }) =>
        value.body === "値 0 / false"
      ),
    ).toBe(true);
    const current = await mcp.call("get_entity_type", { type_id: type.id }),
      schema = await mcp.call("get_entity_schema", { type_id: type.id });
    const rename = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 2,
      edits: [{
        op: "update_property",
        key: "prop_2",
        field: { ...schema.schema.properties.prop_2, title: "현재 수량" },
        required: false,
      }],
    });
    await analyzeAndApply(mcp, type.id, rename.id, rename.version);
    await page.goto(
      workspacePath(
        workspace.id,
        `/entities?entity_type_id=${type.id}&view=table&property_filters=${
          encodeURIComponent(
            JSON.stringify([{ key: "prop_2", operator: "eq", value: 0 }]),
          )
        }`,
      ),
    );
    await expect(
      page.getByRole("columnheader", { name: "제목", exact: true }),
    ).toBeVisible();
    const historical = await mcp.call("get_record", { id: record.id }),
      priorTask = await mcp.call("get_task", { id: task.id });
    expect(historical.body).toBe("過去の本文");
    expect(historical.task_id).toBe(task.id);
    expect(historical.entity_id).toBeNull();
    expect(historical).not.toHaveProperty("entity_context");
    expect(historical).not.toHaveProperty("entity_ids");
    expect(priorTask.entity_context).toEqual(task.entity_context);
    expect((await mcp.call("get_entity", { id: separate.id })).schema_version)
      .toBe(1);
  } finally {
    const latest = await mcp.call("get_business_settings", {
      id: "record_templates",
    });
    await mcp.call("update_business_settings", {
      id: "record_templates",
      expected_version: latest.versions.record_templates,
      value: previous.settings.record_templates ?? {},
    });
    await mcp.close();
  }
});
