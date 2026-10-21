import { decodeIdentifierReference, encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import type { DataModelDocument } from "../supabase/functions/_shared/contracts/data-model.ts";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import type { EntitySchema } from "../supabase/functions/_shared/contracts/entity-type.ts";
import {
  devLogin,
  mcpClient,
  mcpTokenViaConsent,
  test,
  unique,
  ownedWorkspace,
  workspacePath,
} from "./support.ts";
import { saveOnce } from "./ui-actions.ts";

type Mcp = Awaited<ReturnType<typeof mcpClient>>;

async function currentDocument(page: Page, workspaceId: string, typeId: string) {
  await page.goto(workspacePath(workspaceId, "/settings/data-model"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "설정 내보내기", exact: true })
      .click(),
  ]);
  const bundle = JSON.parse(await readFile((await download.path())!, "utf8"));
  return bundle.entity_types.find((t: { schema: EntitySchema }) =>
    t.schema["x-type-id"] === typeId
  ).schema as EntitySchema;
}
async function importModelFile(page: Page, workspaceId: string, document: DataModelDocument) {
  await page.goto(workspacePath(workspaceId, "/settings/data-model"));
  await page.getByLabel("가져오는 방법", { exact: true }).selectOption(
    "update",
  );
  const contents = JSON.stringify(document, null, 2) + "\n";
  const selectFile = page.getByRole("button", { name: "설정 파일 선택", exact: true });
  await expect(selectFile).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    selectFile.click(),
  ]);
  await chooser.setFiles({
    name: "whole-model.json",
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
  await expect(page.getByText("whole-model.json", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "설정 파일 내용", exact: true })).toHaveValue(contents);
  await page.getByRole("button", { name: "가져올 내용 검토", exact: true })
    .click();
  const saveReview = page.getByRole("button", { name: "검토 내용 저장", exact: true });
  await expect(saveReview).toBeVisible();
  const prepared = page.waitForResponse((r) =>
    r.request().method() === "POST" &&
    new URL(r.url()).pathname.endsWith("/data-model/changes")
  );
  await saveReview.click();
  const response = await prepared;
  expect(response.ok()).toBe(true);
  const change = await response.json();
  const applied = page.waitForResponse((r) =>
    r.request().method() === "POST" &&
    new URL(r.url()).pathname.endsWith(`/data-model/changes/${change.id}/apply`)
  );
  await page.getByRole("button", { name: "설정 적용", exact: true }).click();
  const result = await applied;
  expect(result.ok()).toBe(true);
  const value = await result.json();
  expect(value.status).toBe("applied");
  return value;
}
async function importAndPublish(
  page: Page,
  mcp: Mcp,
  typeId: string,
  document: EntitySchema,
) {
  const model = await mcp.call("export_data_model", {}) as DataModelDocument;
  model.entity_types.find((t) => t.schema["x-type-id"] === typeId)!.schema =
    document;
  if (!mcp.workspaceId) throw new Error("explicit model fixture workspace required");
  const change = await importModelFile(page, mcp.workspaceId, model);
  expect((await mcp.call("get_data_model_change", { id: change.id })).status)
    .toBe("applied");
  return mcp.call("get_entity_schema", { type_id: typeId });
}

test("JSON file export→edited import→normal publication→web create/read→MCP export preserves choices, defaults and archive restoration", async ({ page }) => {
  test.setTimeout(240_000);
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("JSON 왕복 자료"),
      icon_id: "leaf",
      initial_property_label: "상품명",
    });
    await workspace.grantKind(type.id);
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
    const exported = await currentDocument(page, workspace.id, type.id);
    expect(exported).toEqual(
      (await mcp.call("get_entity_schema", { type_id: type.id })).schema,
    );
    const label = unique("가져온 상품");
    const edited: EntitySchema = structuredClone(exported);
    edited.title = label;
    edited["x-icon"] = "package";
    edited.properties.prop_8 = {
      type: ["string", "null"],
      title: "판매 상태",
      "x-order": 30,

      oneOf: [{ const: "ready", title: "판매 중" }, {
        const: "closed",
        title: "판매 종료",
      }, {
        const: null,
        title: "미입력",
      }],
      default: null,
    };
    edited.properties.prop_12 = {
      type: ["number", "null"],
      title: "수량",
      "x-order": 40,

      default: 0,
      minimum: 0,
      multipleOf: 0.1,
    };
    edited.properties.prop_16 = {
      type: "string",
      title: "고정 번호",
      "x-order": 50,
      readOnly: true,
      default: "LOCKED",
    };
    const published = await importAndPublish(page, mcp, type.id, edited);
    expect(published.schema_version).toBe(2);
    expect(published.schema).toMatchObject({
      "x-type-id": type.id,
      "x-version": 2,
      title: label,
      "x-icon": "package",
    });
    const propertyKey = (title: string) =>
      Object.entries(published.schema.properties).find(([, value]) =>
        (value as { title?: string }).title === title
      )![0];
    const statusKey = propertyKey("판매 상태"),
      quantityKey = propertyKey("수량"),
      fixedKey = propertyKey("고정 번호");
    expect([statusKey, quantityKey, fixedKey]).toEqual([
      "prop_8",
      "prop_12",
      "prop_16",
    ]);

    await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${type.id}`));
    await page.getByRole("button", { name: `${label} 추가`, exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: `${label} 추가`,
      exact: true,
    });
    const name = unique("파일 왕복 상품");
    await form.getByRole("textbox", { name: "상품명 (필수)", exact: true })
      .fill(name);
    await expect(form.getByLabel("수량", { exact: true })).toHaveValue("0");
    await expect(form.getByLabel("판매 상태", { exact: true })).toHaveValue(
      "null",
    );
    await expect(form.getByLabel("고정 번호", { exact: true })).toHaveCount(0);
    await saveOnce(page, form);
    await expect(form).not.toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true }))
      .toBeVisible();
    const entityId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").at(-1)!,
    );
    const created = await mcp.call("get_entity", { id: entityId });
    const identifier = decodeIdentifierReference(created.id);
    expect(identifier.kind_id).toBe(APP_IDENTIFIER_RULE_ID);
    expect(created.properties).toEqual({
      [published.schema["x-identity-property"]]: encodeIdentifierValue(identifier.kind_id, identifier.raw),
      prop_1: name,
      [statusKey]: null,
      [quantityKey]: 0,
      [fixedKey]: "LOCKED",
    });
    await expect(page.getByText("LOCKED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const edit = page.getByRole("dialog", {
      name: `${label} 편집`,
      exact: true,
    });
    await edit.getByLabel("판매 상태", { exact: true }).selectOption(
      "value:ready",
    );
    await saveOnce(page, edit);
    await expect(edit).not.toBeVisible();
    await expect(page.getByText("판매 중", { exact: true })).toBeVisible();
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual(
      {
        ...created.properties,
        [statusKey]: "ready",
      },
    );

    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
    expect(await currentDocument(page, workspace.id, type.id)).toEqual(published.schema);
    const archived = await importAndPublish(page, mcp, type.id, {
      ...published.schema,
      deprecated: true,
    });
    expect(archived.schema).toMatchObject({ deprecated: true, "x-version": 3 });
    await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${type.id}`));
    await expect(
      page.getByRole("button", { name: `${label} 추가`, exact: true }),
    ).toHaveCount(0);
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual(
      {
        ...created.properties,
        [statusKey]: "ready",
      },
    );
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
    const restored = await importAndPublish(page, mcp, type.id, {
      ...archived.schema,
      deprecated: false,
    });
    expect(restored.schema).toMatchObject({
      deprecated: false,
      "x-version": 4,
    });
    expect(restored.schema.properties).toEqual(published.schema.properties);
    expect(await currentDocument(page, workspace.id, type.id)).toEqual(restored.schema);
    await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${type.id}`));
    await expect(
      page.getByRole("button", { name: `${label} 추가`, exact: true }),
    ).toBeVisible();
  } finally {
    await mcp.close();
  }
});

test("one whole-model file configures two new kinds and their typed relationship for actual web and MCP work", async ({ page }) => {
  test.setTimeout(240_000);
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const productName = unique("파일 상품"), orderName = unique("파일 주문");
    const source: DataModelDocument = {
      format: "workspace-data-model",
      format_version: 1,
      title: unique("상품 주문 모델"),
      entity_types: [
        {
          ref: "products",
          schema: initialEntityDefinition("상품명", {
            id: crypto.randomUUID(),
            title: productName,
            icon: "package",
          }).schema,
        },
        {
          ref: "orders",
          schema: initialEntityDefinition("주문명", {
            id: crypto.randomUUID(),
            title: orderName,
            icon: "box",
          }).schema,
        },
      ],
      relations: [{
        id: crypto.randomUUID(),
        version: 1,
        archived: false,
        ends: [{
          type_ref: "products",
          label: "등록 주문",
          cardinality: "many",
        }, { type_ref: "orders", label: "주문 상품", cardinality: "one" }],
      }],
      identity_definitions: {
        issuers: [{ code: "app", label: "앱", active: true, system: true, version: 1 }],
        rules: [{
          id: APP_IDENTIFIER_RULE_ID,
          source: "app",
          label: "앱 자동 번호",
          meaning: "앱이 자료 등록 시 발급하는 내부 자료 번호",
          generation: "automatic",
          active: true,
          version: 1,
        }],
      },
    };
    const applied = await importModelFile(page, workspace.id, source);
    const detail = await mcp.call("get_data_model_change", { id: applied.id });
    const productType = detail.review.mapping.types.products,
      orderType = detail.review.mapping.types.orders,
      definition = detail.result.relation_ids[0];
    await workspace.grantKind(productType);
    await workspace.grantKind(orderType);
    expect(productType).not.toBe(orderType);
    expect(detail.result.counts.types.added).toBe(2);
    expect(detail.result.counts.relations.added).toBe(1);
    await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${productType}`));
    await page.getByRole("button", { name: `${productName} 추가`, exact: true })
      .click();
    const form = page.getByRole("dialog", {
        name: `${productName} 추가`,
        exact: true,
      }),
      title = unique("모델로 등록한 상품");
    await form.getByRole("textbox", { name: "상품명 (필수)", exact: true })
      .fill(title);
    await saveOnce(page, form);
    await expect(form).not.toBeVisible();
    const productId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").at(-1)!,
    );
    const product = await mcp.call("get_entity", { id: productId });
    expect(product.title).toBe(title);
    const orderTitle = unique("모델로 등록한 주문"),
      order = await mcp.call("create_entity", {
        entity_type_id: orderType,
        schema_version: 1,
        properties: { prop_1: orderTitle },
      });
    await mcp.call("connect_entity_relation", {
      definition_id: definition,
      side: 1,
      origin_id: order.id,
      other_id: product.id,
      expected_definition_version: 1,
      expected_version: order.version,
      expected_other_version: product.version,
    });
    expect(
      (await mcp.call("list_entity_relation_links", {
        definition_id: definition,
        side: 0,
        origin_id: product.id,
      })).items.map((e: { id: string }) => e.id),
    ).toEqual([order.id]);
    await page.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(product.id)}`));
    await expect(
      page.getByLabel("등록 주문 관계", { exact: true }).filter({
        visible: true,
      }).getByRole("button", { name: orderTitle, exact: true }),
    ).toBeVisible();
    const before = await mcp.call("export_data_model", {});
    const repeated = await importModelFile(page, workspace.id, source);
    expect(repeated.result.changed).toBe(false);
    expect(await mcp.call("export_data_model", {})).toEqual(before);
  } finally {
    await mcp.close();
  }
});
