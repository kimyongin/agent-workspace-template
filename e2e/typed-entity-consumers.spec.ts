import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { analyzeAndApply } from "./entity-schema-support.ts";
import { openTabFilters } from "./ui-actions.ts";
test("타입별 목록·AND 필터·업무 문맥·템플릿은 현재 정의를 사용하며 과거 사실을 보존한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} }),
    types: string[] = [],
    entities: string[] = [],
    tasks: string[] = [],
    records: string[] = [];
  const previous = await mcp.call("get_business_settings", { id: "record_templates" });
  try {
    const type = await mcp.call("create_entity_type", { label: unique("조회 자료"), representative_label: "품명" });
    types.push(type.id);
    const other = await mcp.call("create_entity_type", { label: unique("별도 자료"), representative_label: "이름" });
    types.push(other.id);
    const additions = [
      {
        op: "add_property",
        client_ref: "count",
        field: { "x-order": 20, type: ["integer", "null"], title: "수량", minimum: 0, maximum: 1000 },
      },
      {
        op: "add_property",
        client_ref: "day",
        field: { "x-order": 30, type: ["string", "null"], format: "date", title: "날짜" },
      },
      { op: "add_property", client_ref: "checked", field: { "x-order": 40, type: ["boolean", "null"], title: "검사" } },
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
        field: { ...edit.field, "x-show-in-list": edit.client_ref !== "day" },
      })),
    });
    await analyzeAndApply(mcp, type.id, change.id, change.version);
    const first = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 2,
      properties: { prop_1: unique("零資料"), prop_2: 0, prop_3: "2024-02-29", prop_4: false },
    });
    entities.push(first.id);
    const second = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 2,
      properties: { prop_1: unique("二資料"), prop_2: 2, prop_3: "2025-01-01", prop_4: true },
    });
    entities.push(second.id);
    const separate = await mcp.call("create_entity", {
      entity_type_id: other.id,
      schema_version: 1,
      properties: { prop_1: unique("別資料") },
    });
    entities.push(separate.id);
    const task = await mcp.call("create_task", {
      kind: "once",
      title: unique("型別業務"),
      entity_ids: [first.id, separate.id],
    });
    tasks.push(task.id);
    const record = await mcp.call("create_record", { body: "過去の本文", entity_ids: [first.id, separate.id] });
    records.push(record.id);
    expect(task.entity_context.find((context: { id: string }) => context.id === first.id).type.label).toBe(type.label);
    await page.goto(`/entities?entity_type_id=${type.id}&view=table`);
    await expect(page.getByRole("columnheader", { name: "수량", exact: true })).toBeVisible();
    await openTabFilters(page);
    await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
    await page.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_2");
    await page.getByLabel("조건 1 비교", { exact: true }).selectOption("gte");
    await page.getByLabel("조건 1 값", { exact: true }).fill("0");
    await page.getByRole("button", { name: "속성 조건 적용", exact: true }).click();
    await expect(page.getByRole("button", { name: first.title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: second.title, exact: true })).toBeVisible();
    await page.goto("/settings/records");
    await page.getByLabel("대상", { exact: true }).selectOption(`type:${type.id}`);
    const template = page.getByRole("form", { name: "기록 자동 완성" });
    await template.getByLabel("액션", { exact: true }).selectOption("update");
    await template.getByLabel("메모 템플릿", { exact: true }).fill("値 $엔터티.이후.prop_2$ / $엔터티.이후.prop_4$");
    await template.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
    await expect(template.getByRole("status").filter({ hasText: "기록 자동 완성을 저장했습니다." })).toHaveText(
      "기록 자동 완성을 저장했습니다.",
    );
    const updated = await mcp.call("update_entity", {
      id: second.id,
      expected_version: second.version,
      schema_version: 2,
      properties: { prop_2: 0, prop_4: false },
    });
    expect(updated.properties.prop_2).toBe(0);
    const logs = await mcp.call("list_records", { entity_id: second.id, record_kind: "change" });
    expect(logs.items.some((value: { body: string }) => value.body === "値 0 / false")).toBe(true);
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
      `/entities?entity_type_id=${type.id}&view=table&property_filters=${
        encodeURIComponent(JSON.stringify([{ key: "prop_2", operator: "eq", value: 0 }]))
      }`,
    );
    await expect(page.getByRole("columnheader", { name: "현재 수량", exact: true })).toBeVisible();
    const historical = await mcp.call("get_record", { id: record.id }),
      priorTask = await mcp.call("get_task", { id: task.id });
    expect(historical.body).toBe("過去の本文");
    expect(historical.entity_context).toEqual(record.entity_context);
    expect(priorTask.entity_context).toEqual(task.entity_context);
    expect((await mcp.call("get_entity", { id: separate.id })).schema_version).toBe(1);
  } finally {
    const latest = await mcp.call("get_business_settings", { id: "record_templates" });
    await mcp.call("update_business_settings", {
      id: "record_templates",
      expected_version: latest.versions.record_templates,
      value: previous.settings.record_templates ?? {},
    });
    if (tasks.length) await admin`delete from app.tasks where id=any(${tasks}::text[])`;
    if (records.length) await admin`delete from app.records where id=any(${records}::text[])`;
    if (entities.length) await admin`delete from app.entities where id=any(${entities}::text[])`;
    if (types.length) await admin`delete from app.entity_types where id=any(${types}::uuid[])`;
    await mcp.close();
    await admin.end();
  }
});
