import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { EntitySchema } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
import { saveOnce } from "./ui-actions.ts";

type Mcp = Awaited<ReturnType<typeof mcpClient>>;

async function currentDocument(page: Page) {
  const history = page.getByRole("region", { name: "변경 이력", exact: true });
  const toggle = history.getByRole("heading", { level: 2, name: /^변경 이력/ }).getByRole("button");
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    history.getByRole("button", { name: "현재 정의 JSON 내보내기", exact: true }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, "utf8")) as EntitySchema;
}

async function importAndPublish(page: Page, mcp: Mcp, typeId: string, document: EntitySchema) {
  const section = page.getByRole("region", { name: "정의 가져오기", exact: true });
  const toggle = section.getByRole("button", { name: /^정의 가져오기/ });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await expect(section.getByLabel("가져오는 방법")).toHaveValue("update");
  await section.getByLabel("JSON 파일", { exact: true }).setInputFiles({
    name: "edited-schema.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document, null, 2) + "\n"),
  });
  await section.getByRole("button", { name: "가져올 내용 검토", exact: true }).click();
  const prepared = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/entity-schema-import/prepare")
  );
  await section.getByRole("button", { name: "검토한 정의로 변경안 만들기", exact: true }).click();
  const response = await prepared;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.change).toMatchObject({ type_id: typeId, status: "draft" });
  await expect(page).toHaveURL(new RegExp(`change_id=${result.change.id}`));
  const history = page.getByRole("region", { name: "변경 이력", exact: true });
  await history.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect.poll(async () => {
    await schemaAnalysisTick();
    return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: result.change.id })).status;
  }, { timeout: 60_000 }).toBe("ready");
  await expect(history.getByRole("button", { name: "변경 적용", exact: true })).toBeEnabled();
  await history.getByRole("button", { name: "변경 적용", exact: true }).click();
  await expect.poll(
    async () => (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: result.change.id })).status,
    { timeout: 30_000 },
  ).toBe("applied");
  const published = await mcp.call("get_entity_schema", { type_id: typeId });
  await expect(history.getByRole("heading", { level: 2, name: /^변경 이력/ }).getByRole("button")).toContainText(
    `현재 버전 ${published.schema_version}`,
  );
  return published;
}

test("JSON file export→edited import→normal publication→web create/read→MCP export preserves choices, defaults and archive restoration", async ({ page }) => {
  test.setTimeout(240_000);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("JSON 왕복 자료"),
      icon_id: "leaf",
      representative_label: "상품명",
    });
    await page.goto(`/settings/entity-types/${type.id}`);
    const exported = await currentDocument(page);
    expect(exported).toEqual((await mcp.call("get_entity_schema", { type_id: type.id })).schema);
    const label = unique("가져온 상품");
    const edited: EntitySchema = structuredClone(exported);
    edited.title = label;
    edited["x-icon"] = "package";
    edited.properties.prop_8 = {
      type: ["string", "null"],
      title: "판매 상태",
      "x-order": 20,
      "x-show-in-list": true,
      oneOf: [{ const: "ready", title: "판매 중" }, { const: "closed", title: "판매 종료" }, {
        const: null,
        title: "미입력",
      }],
      default: null,
    };
    edited.properties.prop_12 = {
      type: ["number", "null"],
      title: "수량",
      "x-order": 30,
      "x-show-in-list": true,
      default: 0,
      minimum: 0,
      multipleOf: 0.1,
    };
    edited.properties.prop_16 = {
      type: "string",
      title: "고정 번호",
      "x-order": 40,
      readOnly: true,
      default: "LOCKED",
    };
    const published = await importAndPublish(page, mcp, type.id, edited);
    expect(published.schema_version).toBe(2);
    expect(published.schema).toMatchObject({ "x-type-id": type.id, "x-version": 2, title: label, "x-icon": "package" });
    const propertyKey = (title: string) =>
      Object.entries(published.schema.properties).find(([, value]) =>
        (value as { title?: string }).title === title
      )![0];
    const statusKey = propertyKey("판매 상태"), quantityKey = propertyKey("수량"), fixedKey = propertyKey("고정 번호");
    expect([statusKey, quantityKey, fixedKey]).toEqual(["prop_2", "prop_3", "prop_4"]);

    await page.goto(`/entities?entity_type_id=${type.id}`);
    await page.getByRole("button", { name: `${label} 추가`, exact: true }).click();
    const form = page.getByRole("dialog", { name: `${label} 추가`, exact: true });
    const name = unique("파일 왕복 상품");
    await form.getByRole("textbox", { name: "상품명 (필수)", exact: true }).fill(name);
    await expect(form.getByLabel("수량", { exact: true })).toHaveValue("0");
    await expect(form.getByLabel("판매 상태", { exact: true })).toHaveValue("null");
    await expect(form.getByLabel("고정 번호", { exact: true })).toHaveCount(0);
    await saveOnce(page, form);
    await expect(form).not.toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const entityId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    const created = await mcp.call("get_entity", { id: entityId });
    expect(created.properties).toEqual({ prop_1: name, [statusKey]: null, [quantityKey]: 0, [fixedKey]: "LOCKED" });
    await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const edit = page.getByRole("dialog", { name: `${label} 편집`, exact: true });
    await edit.getByLabel("판매 상태", { exact: true }).selectOption("value:ready");
    await saveOnce(page, edit);
    await expect(edit).not.toBeVisible();
    await expect(page.getByText("판매 중", { exact: true })).toBeVisible();
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({
      ...created.properties,
      [statusKey]: "ready",
    });

    await page.goto(`/settings/entity-types/${type.id}`);
    expect(await currentDocument(page)).toEqual(published.schema);
    const archived = await importAndPublish(page, mcp, type.id, { ...published.schema, deprecated: true });
    expect(archived.schema).toMatchObject({ deprecated: true, "x-version": 3 });
    await page.goto(`/entities?entity_type_id=${type.id}`);
    await expect(page.getByRole("button", { name: `${label} 추가`, exact: true })).toHaveCount(0);
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({
      ...created.properties,
      [statusKey]: "ready",
    });
    await page.goto(`/settings/entity-types/${type.id}`);
    const restored = await importAndPublish(page, mcp, type.id, { ...archived.schema, deprecated: false });
    expect(restored.schema).toMatchObject({ deprecated: false, "x-version": 4 });
    expect(restored.schema.properties).toEqual(published.schema.properties);
    expect(await currentDocument(page)).toEqual(restored.schema);
    await page.goto(`/entities?entity_type_id=${type.id}`);
    await expect(page.getByRole("button", { name: `${label} 추가`, exact: true })).toBeVisible();
  } finally {
    await mcp.close();
  }
});
