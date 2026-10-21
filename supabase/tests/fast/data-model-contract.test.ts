import { assertEquals } from "@std/assert";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { dataModelTools } from "../../functions/_shared/adapters/mcp/data-model-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import type { DataModelDocument, ModelReview } from "../../functions/_shared/contracts/data-model.ts";
import type { DataModelDeps } from "../../functions/_shared/core/data-model/application.ts";
const actor = { userId: "10000000-0000-4000-8000-000000000001", workspaceId: "20000000-0000-4000-8000-000000000001" };
function transport() {
  const schema =
    initialEntityDefinition("이름", { id: "30000000-0000-4000-8000-000000000001", title: "상품", icon: "box" }).schema;
  const kinds = ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"];
  schema.properties.prop_3 = {
    type: "string",
    title: "외부 번호",
    "x-order": 30,
    "x-identifier": { allowed_kind_ids: kinds, default_kind_id: kinds[0] },
    default: kinds[1] + ":한:글",
  };
  const document: DataModelDocument = {
    format: "workspace-data-model",
    format_version: 1,
    title: "상품 모델",
    entity_types: [{ ref: "product", schema }],
    relations: [],
    identity_definitions: {
      issuers: [{ code: "app", label: "앱", active: true, system: true, version: 1 }, {
        code: "seller",
        label: "판매자",
        active: true,
        system: false,
        version: 1,
      }],
      rules: [
        {
          id: APP_IDENTIFIER_RULE_ID,
          source: "app",
          label: "자동",
          meaning: "앱 번호",
          generation: "automatic",
          active: true,
          version: 1,
        },
        ...kinds.map((id) => ({
          id,
          source: "seller",
          label: "번호",
          meaning: id,
          generation: "direct" as const,
          active: true,
          version: 1,
        })),
      ],
    },
  };
  const deps = {
    uow: {
      run: (_actor: unknown, fn: (store: unknown) => unknown) =>
        fn({
          exportDocument: () => Promise.resolve(document),
          snapshot: () =>
            Promise.resolve({
              document,
              types: { [schema["x-type-id"]]: { next_property_number: 4, count: 0, locked: false } },
            }),
        }),
    },
  } as unknown as DataModelDeps;
  const app = createHttpApp(
    {} as never,
    { basePath: "/api", token: { audience: "authenticated", issuer: "https://auth.invalid" }, allowedOrigins: [] },
    {} as never,
    {} as never,
    () => Promise.resolve({ userId: actor.userId }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    deps,
  );
  const tools = dataModelTools(deps);
  const tool = (name: string, input: unknown) => tools.find((t) => t.name === name)!.handler(input as never, actor);
  const http = (path: string, input?: unknown) =>
    app.fetch(
      new Request("https://app.invalid/api" + path, {
        method: input ? "POST" : "GET",
        headers: { "X-Workspace-Id": actor.workspaceId, "Content-Type": "application/json" },
        ...(input ? { body: JSON.stringify(input) } : {}),
      }),
    );
  return { document, kinds, http, tool };
}
Deno.test("HTTP and MCP export and copy the same field-only model with two kinds from one issuer", async () => {
  const t = transport();
  const exported = await (await t.http("/data-model/export")).json();
  assertEquals(exported, await t.tool("export_data_model", {}));
  assertEquals(Object.hasOwn(exported.entity_types[0], "identity"), false);
  const input = { mode: "copy", document: JSON.stringify(exported) };
  const response = await t.http("/data-model/preview", input);
  assertEquals(response.status, 200);
  const review = await response.json() as ModelReview;
  assertEquals(review, JSON.parse(JSON.stringify(await t.tool("preview_data_model", input))));
  assertEquals(review.mapping.rules[APP_IDENTIFIER_RULE_ID], APP_IDENTIFIER_RULE_ID);
  assertEquals(review.mapping.rules[t.kinds[0]] === review.mapping.rules[t.kinds[1]], false);
  assertEquals(review.items[0].schema!.properties.prop_3.default, review.mapping.rules[t.kinds[1]] + ":한:글");
});
Deno.test("HTTP and MCP reject a legacy per-type identity envelope at the same model boundary", async () => {
  const t = transport();
  const document = { ...t.document, entity_types: [{ ...t.document.entity_types[0], identity: { label: "구 설정" } }] };
  const input = { mode: "update", document: JSON.stringify(document) },
    response = await t.http("/data-model/preview", input);
  assertEquals(response.status, 400);
  let error: unknown;
  try {
    await t.tool("preview_data_model", input);
  } catch (caught) {
    error = caught;
  }
  assertEquals(await response.json(), toErrorBody(error).body);
});
