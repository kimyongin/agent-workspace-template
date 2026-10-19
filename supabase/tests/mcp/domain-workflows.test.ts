import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { grantOwnedKinds } from "./_workspace-grants.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";

activityWorkspaceSuite(
  "two domains use one model and MCP workflow: product-market numbers and recipe quantities",
  async ({ A: token, B: foreign, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const write = async (name: string, input: Record<string, unknown>, key = crypto.randomUUID()) => {
      const value = await scopedTool(client, w, name, { ...input, request_key: key });
      assert(!value.error, `${name}: ${JSON.stringify(value.error)}`);
      return value;
    };
    const install = async (name: string) => {
      const document = JSON.parse(
        await Deno.readTextFile(`docs/examples/data-model/${name}.json`),
      ) as DataModelDocument;
      const input = { document: JSON.stringify(document), mode: "copy" };
      const review = await scopedTool(client, w, "preview_data_model", input);
      assertEquals(review.can_apply, true);
      const prepared = await write("prepare_data_model", { ...input, preview_fingerprint: review.fingerprint });
      const applied = await write("apply_data_model", { id: prepared.id, expected_version: prepared.version });
      assertEquals(applied.status, "applied");
      await grantOwnedKinds(token, w, applied.result.type_ids);
      return { document, mapping: review.mapping };
    };
    type Model = Awaited<ReturnType<typeof install>>;
    const entityInput = async (
      model: Model,
      ref: string,
      props: Record<string, string | number>,
      external?: string,
    ) => {
      const id = model.mapping.types[ref], schema = await scopedTool(client, w, "get_entity_schema", { type_id: id });
      const identity = await scopedTool(client, w, "get_entity_type_identity", { type_id: id });
      return {
        entity_type_id: id,
        schema_version: schema.schema_version,
        identity_version: identity.version,
        source: identity.default_source,
        ...(external ? { external_id: external } : {}),
        properties: Object.fromEntries(
          Object.entries(props).map(([key, value]) => [model.mapping.properties[ref][key], value]),
        ),
      };
    };
    const create = async (model: Model, ref: string, props: Record<string, string | number>) => {
      const value = await write("create_entity", await entityInput(model, ref, props));
      return value;
    };
    const related = async (
      model: Model,
      relation: number,
      originId: string,
      ref: string,
      props: Record<string, string | number>,
      external?: string,
    ) => {
      const definitionId = model.mapping.relations[model.document.relations[relation].id];
      const definition = await scopedTool(client, w, "get_entity_relation_definition", { id: definitionId });
      const origin = await scopedTool(client, w, "get_entity", { id: originId });
      const input = {
        definition_id: definitionId,
        side: 0,
        origin_id: originId,
        expected_definition_version: definition.version,
        expected_version: origin.version,
        previous_other_id: null,
        expected_previous_version: null,
        entity: await entityInput(model, ref, props, external),
      };
      const key = crypto.randomUUID(), created = await write("create_and_link_entity", input, key);
      assertEquals(await write("create_and_link_entity", input, key), created);
      return created.entity;
    };
    const connect = async (model: Model, relation: number, originId: string, otherId: string) => {
      const definitionId = model.mapping.relations[model.document.relations[relation].id];
      const definition = await scopedTool(client, w, "get_entity_relation_definition", { id: definitionId });
      const origin = await scopedTool(client, w, "get_entity", { id: originId });
      const other = await scopedTool(client, w, "get_entity", { id: otherId });
      return write("connect_entity_relation", {
        definition_id: definitionId,
        side: 0,
        origin_id: originId,
        other_id: otherId,
        expected_definition_version: definition.version,
        expected_version: origin.version,
        expected_other_version: other.version,
      });
    };
    const market = await install("openmarket"), cooking = await install("cooking");
    const product = await create(market, "product", { prop_1: "가상 사과 상품", prop_2: "검증용 농장" });
    const sku = await related(market, 0, product.id, "sku", {
      prop_1: "사과 500g",
      prop_2: "500g",
      prop_3: 11900,
      prop_4: 20,
    }, `SKU-${crypto.randomUUID()}`);
    const cp = await related(market, 1, sku.id, "offer", {
      prop_1: "쿠팡 사과 500g",
      prop_2: "coupang",
      prop_4: "CP-100",
      prop_6: 11900,
      prop_7: "listed",
    });
    const auction = await related(market, 1, sku.id, "offer", {
      prop_1: "옥션 사과 500g",
      prop_2: "auction",
      prop_4: "AU-900",
      prop_6: 12500,
      prop_7: "listed",
    });
    assert(cp.id !== auction.id);
    const offers = await scopedTool(client, w, "list_entity_relation_links", {
      definition_id: market.mapping.relations[market.document.relations[1].id],
      side: 0,
      origin_id: sku.id,
    });
    assertEquals(new Set(offers.items.map((item: { id: string }) => item.id)), new Set([cp.id, auction.id]));
    const numberKey = market.mapping.properties.offer.prop_4;
    assertEquals([cp.properties[numberKey], auction.properties[numberKey]], ["CP-100", "AU-900"]);
    const customer = await create(market, "customer", { prop_1: "가상 고객", prop_2: "coupang" });
    const order = await related(market, 2, customer.id, "order", {
      prop_1: "가상 주문",
      prop_2: "coupang",
      prop_3: "ORDER-001",
      prop_4: "paid",
    });
    const item = await related(market, 3, order.id, "order_item", { prop_1: "사과 두 개", prop_2: 2, prop_3: 11900 });
    await connect(market, 4, cp.id, item.id);
    const inquiry = await related(market, 5, product.id, "inquiry", {
      prop_1: "가상 배송 문의",
      prop_2: "언제 출고되나요?",
      prop_3: "open",
    });
    const current = await scopedTool(client, w, "get_entity", { id: inquiry.id });
    await write("update_entity", {
      id: inquiry.id,
      schema_version: current.current_schema_version,
      expected_version: current.version,
      properties: {
        [market.mapping.properties.inquiry.prop_3]: "drafted",
        [market.mapping.properties.inquiry.prop_4]: "가상 답변 초안: 내일 출고 예정입니다.",
      },
    });
    const ingredient = await create(cooking, "ingredient", { prop_1: "가상 쌀", prop_2: "kg" });
    const recipe = await create(cooking, "recipe", { prop_1: "가상 볶음밥", prop_2: 20 });
    const component = await related(cooking, 0, recipe.id, "recipe_item", { prop_1: "쌀 200g", prop_2: 0.2 });
    await connect(cooking, 1, ingredient.id, component.id);
    assertEquals(component.properties[cooking.mapping.properties.recipe_item.prop_2], 0.2);
    const exported = await scopedTool(client, w, "export_data_model", {});
    const review = await scopedTool(client, w, "preview_data_model", {
      document: JSON.stringify(exported),
      mode: "update",
    });
    assertEquals(review.items.every((item: { kind: string }) => item.kind === "unchanged"), true);
    assertEquals(JSON.stringify(exported).includes("CP-100"), false);
    assertEquals((await scopedHttp(foreign, otherW, "GET", `/entities/${encodeURIComponent(product.id)}`)).status, 404);
    console.info(
      "two-domain proof: 10 kinds / 8 relation definitions; one SKU has two market IDs; orders, inquiry draft and recipe quantity use shared MCP commands",
    );
  },
  { mcp: true },
);
