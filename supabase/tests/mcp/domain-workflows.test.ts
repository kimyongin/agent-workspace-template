import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn, SUPABASE_URL } from "../http/_client.ts";
import { claimsOf, connectMcp, mcpGrant, tool } from "./_mcp.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";

httpTest("two domains use one model and MCP workflow: product-market numbers and recipe quantities", async () => {
  const token = await signIn("A"), grant = await mcpGrant(token), client = await connectMcp(grant.access_token);
  const owner = String(claimsOf(token).sub), keys: string[] = [], changes: string[] = [], typeIds: string[] = [];
  const relationIds: string[] = [],
    entityIds: string[] = [],
    ruleIds: string[] = [],
    issuerCodes: string[] = [],
    errors: unknown[] = [];
  const before = await tool(client, "export_data_model", {});
  const write = async (name: string, input: Record<string, unknown>, key = crypto.randomUUID()) => {
    keys.push(key);
    const value = await tool(client, name, { ...input, request_key: key });
    assert(!value.error, `${name}: ${JSON.stringify(value.error)}`);
    return value;
  };
  const install = async (name: string) => {
    const document = JSON.parse(await Deno.readTextFile(`docs/examples/data-model/${name}.json`)) as DataModelDocument;
    const input = { document: JSON.stringify(document), mode: "copy" };
    const review = await tool(client, "preview_data_model", input);
    assertEquals(review.can_apply, true);
    for (const rule of document.identity_definitions.rules) {
      const mapped = review.mapping.rules[rule.id];
      if (
        rule.source !== "app" && !before.identity_definitions.rules.some((old: { id: string }) => old.id === mapped)
      ) ruleIds.push(mapped);
    }
    for (const issuer of document.identity_definitions.issuers) {
      if (
        !issuer.system && !before.identity_definitions.issuers.some((old: { code: string }) => old.code === issuer.code)
      ) issuerCodes.push(issuer.code);
    }
    const prepared = await write("prepare_data_model", { ...input, preview_fingerprint: review.fingerprint });
    changes.push(prepared.id);
    typeIds.push(...Object.values(review.mapping.types) as string[]);
    relationIds.push(...Object.values(review.mapping.relations) as string[]);
    const applied = await write("apply_data_model", { id: prepared.id, expected_version: prepared.version });
    assertEquals(applied.status, "applied");
    return { document, mapping: review.mapping };
  };
  type Model = Awaited<ReturnType<typeof install>>;
  const entityInput = async (model: Model, ref: string, props: Record<string, string | number>, external?: string) => {
    const id = model.mapping.types[ref], schema = await tool(client, "get_entity_schema", { type_id: id });
    const identity = await tool(client, "get_entity_type_identity", { type_id: id });
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
    entityIds.push(value.id);
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
    const definition = await tool(client, "get_entity_relation_definition", { id: definitionId });
    const origin = await tool(client, "get_entity", { id: originId });
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
    entityIds.push(created.entity.id);
    assertEquals(await write("create_and_link_entity", input, key), created);
    return created.entity;
  };
  const connect = async (model: Model, relation: number, originId: string, otherId: string) => {
    const definitionId = model.mapping.relations[model.document.relations[relation].id];
    const definition = await tool(client, "get_entity_relation_definition", { id: definitionId });
    const origin = await tool(client, "get_entity", { id: originId });
    const other = await tool(client, "get_entity", { id: otherId });
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
  try {
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
    const offers = await tool(client, "list_entity_relation_links", {
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
    const current = await tool(client, "get_entity", { id: inquiry.id });
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
    const exported = await tool(client, "export_data_model", {});
    const review = await tool(client, "preview_data_model", { document: JSON.stringify(exported), mode: "update" });
    assertEquals(review.items.every((item: { kind: string }) => item.kind === "unchanged"), true);
    assertEquals(JSON.stringify(exported).includes("CP-100"), false);
    assertEquals((await call(await signIn("B"), "GET", `/entities/${encodeURIComponent(product.id)}`)).status, 404);
    console.info(
      "two-domain proof: 10 kinds / 8 relation definitions; one SKU has two market IDs; orders, inquiry draft and recipe quantity use shared MCP commands",
    );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await admin.begin(async (tx) => {
        const owned =
          await tx`select id from app.entities where owner_id=${owner} and entity_type_id=any(${typeIds}::uuid[])`;
        const ids = [...new Set([...entityIds, ...owned.map((row) => String(row.id))])];
        const records = await tx`select id from app.records where owner_id=${owner} and entity_ids && ${ids}::text[]`;
        const recordIds = records.map((row) => String(row.id));
        await tx`delete from private.request_results where owner_id=${owner} and request_key=any(${keys}::uuid[])`;
        await tx`delete from pgmq.q_search_index where message->>'owner_id'=${owner} and message->>'id'=any(${recordIds}::text[])`;
        await tx`delete from pgmq.a_search_index where message->>'owner_id'=${owner} and message->>'id'=any(${recordIds}::text[])`;
        await tx`delete from private.passage_effects where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
        await tx`delete from app.search_chunks where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
        await tx`delete from app.search_index_state where owner_id=${owner} and kind='record' and id=any(${recordIds}::text[])`;
        await tx`delete from app.records where owner_id=${owner} and id=any(${recordIds}::text[])`;
        await tx`delete from app.entity_relation_links where owner_id=${owner} and definition_id=any(${relationIds}::uuid[])`;
        await tx`delete from app.entities where owner_id=${owner} and entity_type_id=any(${typeIds}::uuid[])`;
        await tx`delete from app.entity_relation_definitions where owner_id=${owner} and id=any(${relationIds}::uuid[])`;
        await tx`delete from app.data_model_changes where owner_id=${owner} and id=any(${changes}::uuid[])`;
        await tx`delete from app.entity_types where owner_id=${owner} and id=any(${typeIds}::uuid[])`;
        await tx`delete from app.entity_identifier_rules where owner_id=${owner} and id=any(${ruleIds}::uuid[])`;
        await tx`delete from app.entity_issuers where owner_id=${owner} and code=any(${issuerCodes}::text[])`;
      });
    } catch (error) {
      errors.push(error);
    }
    try {
      await client.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
      assert(secret, "local OAuth cleanup key is configured");
      const removed = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(grant.client_id)}`,
        {
          method: "DELETE",
          headers: { apikey: secret, authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      await removed.body?.cancel();
      assert(removed.ok || removed.status === 404, "run-owned OAuth client cleanup succeeds");
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "two-domain workflow or owned fixture cleanup failed");
});
