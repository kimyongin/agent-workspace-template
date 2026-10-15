import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { entityIssuerRoutes } from "../../functions/_shared/adapters/http/entity-issuer-routes.ts";
import { entityIssuerTools } from "../../functions/_shared/adapters/mcp/entity-issuer-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import type { EntityIssuerDeps, EntityIssuerStore } from "../../functions/_shared/core/entity-issuers/application.ts";
const typeId = "11111111-1111-4111-8111-111111111111";
const actor = { userId: "owner", request: { key: "11111111-1111-4111-8111-111111111111" } };
Deno.test("HTTP and MCP identity reads return reusable rule labels and the independent version", async () => {
  const identity = {
    type_id: typeId,
    label: "상품 번호",
    default_source: "coupang",
    version: 7,
    sources: [{
      code: "coupang",
      rule_id: "22222222-2222-4222-8222-222222222222",
      active: true,
      source_label: "쿠팡",
      rule_label: "상품 ID",
      generation: "direct",
    }],
  };
  const d: EntityIssuerDeps = {
    uow: {
      run: (a, fn) => {
        assertEquals(a.userId, "owner");
        return fn({
          getTypeIdentity: (id: string) => {
            assertEquals(id, typeId);
            return Promise.resolve(identity);
          },
        } as unknown as EntityIssuerStore);
      },
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityIssuerRoutes(d));
  const response = await app.request(`/entity-types/${typeId}/identity`);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), identity);
  const tool = entityIssuerTools(d).find((t) => t.name === "get_entity_type_identity")!;
  assertEquals(tool.readOnly, true);
  assertEquals(await tool.handler({ type_id: typeId }, actor), identity);
});
Deno.test("HTTP and MCP reject mutable issuer codes and external automatic generation", async () => {
  const d: EntityIssuerDeps = {
    uow: {
      run: () => {
        throw new Error("must not reach storage");
      },
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityIssuerRoutes(d));
  app.onError((e, c) => {
    const { body, status } = toErrorBody(e);
    return c.json(body, status as 400);
  });
  const response = await app.request("/entity-issuers/coupang", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expected_version: 1, code: "naver", label: "네이버" }),
  });
  assertEquals(response.status, 400);
  assertEquals((await response.json()).code, "invalid_input");
  const tool = entityIssuerTools(d).find((t) => t.name === "create_entity_identifier_rule")!;
  const e = await assertRejects(async () =>
    await tool.handler({
      source: "coupang",
      label: "상품 ID",
      meaning: "쿠팡 상품",
      generation: "automatic",
      request_key: crypto.randomUUID(),
    }, actor)
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});

Deno.test("HTTP and MCP enforce registry system-definition policy through the shared core", async () => {
  const appIssuer = { code: "app", label: "앱", active: true, system: true, version: 1 },
    appRule = {
      id: "00000000-0000-4000-8000-000000000001",
      source: "app",
      label: "자동 발급",
      meaning: "앱 번호",
      generation: "automatic",
      active: true,
      version: 1,
    };
  const d: EntityIssuerDeps = {
    uow: {
      run: (_actor, fn) =>
        fn({
          executeRequest: <T>(_r: unknown, execute: () => Promise<T>) => execute(),
          lockIssuer: () => Promise.resolve(appIssuer),
          defaultTypes: () => Promise.resolve([{ type_id: typeId, label: "상품" }]),
          lockRule: () => Promise.resolve(appRule),
          ruleUsage: () => Promise.resolve({ referenced: true, defaultTypes: [{ type_id: typeId, label: "상품" }] }),
        } as unknown as EntityIssuerStore),
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityIssuerRoutes(d));
  app.onError((e, c) => {
    const { body, status } = toErrorBody(e);
    return c.json(body, status as 400);
  });
  const response = await app.request("/entity-issuers/app", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: false, expected_version: 1 }),
  });
  assertEquals(response.status, 400);
  assertEquals((await response.json()).code, "invalid_input");
  const tool = entityIssuerTools(d).find((t) => t.name === "update_entity_identifier_rule")!;
  const e = await assertRejects(() =>
    tool.handler(
      { rule_id: appRule.id, meaning: "외부 번호", expected_version: 1, request_key: crypto.randomUUID() },
      actor,
    )
  );
  assertEquals((e as { code: string }).code, "invalid_input");
});

Deno.test("HTTP and MCP expose identical unused deletion and default-policy fields", async () => {
  let deletions = 0;
  const current = { code: "crm", label: "고객", active: true, system: false, version: 3 };
  const defaults = [{ type_id: typeId, label: "상품" }];
  const d: EntityIssuerDeps = {
    uow: {
      run: (_a, fn) =>
        fn({
          executeRequest: <T>(_r: unknown, execute: () => Promise<T>) => execute(),
          lockIssuer: () => Promise.resolve(current),
          defaultTypes: () => Promise.resolve(defaults),
          issuerHasDependencies: () => Promise.resolve(false),
          deleteIssuer: () => {
            deletions++;
            return Promise.resolve();
          },
        } as unknown as EntityIssuerStore),
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityIssuerRoutes(d));
  app.onError((e, c) => {
    const { body, status } = toErrorBody(e);
    return c.json(body, status as 400);
  });
  const response = await app.request("/entity-issuers/crm", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: false, expected_version: 3 }),
  });
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.fields, [{ path: `default_types.${typeId}`, message: "상품" }]);
  const tools = entityIssuerTools(d);
  const failure = await assertRejects(() =>
    tools.find((t) => t.name === "update_entity_issuer")!.handler({
      code: "crm",
      active: false,
      expected_version: 3,
      request_key: crypto.randomUUID(),
    }, actor)
  );
  assertEquals(toErrorBody(failure).body, body);
  const removed = await app.request("/entity-issuers/crm", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expected_version: 3 }),
  });
  assertEquals(await removed.json(), { deleted: true });
  const tool = tools.find((t) => t.name === "delete_entity_issuer")!;
  assertEquals(tool.readOnly, false);
  assertEquals(await tool.handler({ code: "crm", expected_version: 3, request_key: crypto.randomUUID() }, actor), {
    deleted: true,
  });
  assertEquals(deletions, 2);
});
