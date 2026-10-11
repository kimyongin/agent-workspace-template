import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { settingsRoutes } from "../../functions/_shared/adapters/http/settings-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { settingsTools } from "../../functions/_shared/adapters/mcp/settings-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { BusinessSettingsDeps } from "../../functions/_shared/core/settings/application.ts";
import type { BusinessSettingsResult } from "../../functions/_shared/contracts/business-settings.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

const actor = { userId: crypto.randomUUID() };
function fixture(saved: BusinessSettingsResult = {
  versions: { entity_identity: 0, record_templates: 4 },
  settings: { record_templates: { task: { create: { memo: "추가", tag_ids: [] } } } },
}) {
  const deps: BusinessSettingsDeps = {
    clock: { now: () => new Date("2026-10-10T00:00:00Z") },
    uow: {
      run: (_actor, fn) =>
        fn({
          executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
          get: () => Promise.resolve(saved),
          update: () => Promise.reject(new Error("읽기 전용")),
          recordTags: () => Promise.resolve([]),
        }),
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", settingsRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const read = settingsTools(deps).find((tool) => tool.name === "get_business_settings")!;
  return { app, read };
}
Deno.test("업무 설정 HTTP/MCP: 발급처만 조회하면 해석한 기본값과 해당 버전만 반환", async () => {
  const { app, read } = fixture();
  const expected = {
    versions: { entity_identity: 0 },
    settings: {
      entity_identity: { generation: "short", default_source: "app", sources: [{ code: "app", label: "앱" }] },
    },
  };
  const response = await app.request("/settings/business?id=entity_identity");
  assertEquals(response.status, 200);
  assertEquals(await response.json(), expected);
  assertEquals(await read.handler({ id: "entity_identity" }, actor), expected);
});

Deno.test("업무 설정 HTTP/MCP: 기록 템플릿 선택·선택 생략 전체·잘못된 선택자 거절", async () => {
  const { app, read } = fixture();
  const templates = {
    versions: { record_templates: 4 },
    settings: { record_templates: { task: { create: { memo: "추가", tag_ids: [] } } } },
  };
  assertEquals(await (await app.request("/settings/business?id=record_templates")).json(), templates);
  assertEquals(await read.handler({ id: "record_templates" }, actor), templates);
  const full = {
    versions: { entity_identity: 0, record_templates: 4 },
    settings: {
      entity_identity: { generation: "short", default_source: "app", sources: [{ code: "app", label: "앱" }] },
      record_templates: { task: { create: { memo: "추가", tag_ids: [] } } },
    },
  };
  assertEquals(await (await app.request("/settings/business")).json(), full);
  assertEquals(await read.handler({}, actor), full);
  for (const id of ["", "unknown", "ENTITY_IDENTITY"]) {
    assertEquals((await app.request(`/settings/business?id=${id}`)).status, 400);
    assertEquals((await assertRejects(async () => await read.handler({ id }, actor), AppError)).code, "invalid_input");
  }
  for (const id of [null, 1, [], {}]) {
    assertEquals((await assertRejects(async () => await read.handler({ id }, actor), AppError)).code, "invalid_input");
  }
  assertEquals(
    (await assertRejects(async () => await read.handler({ owner_id: actor.userId }, actor), AppError)).code,
    "invalid_input",
  );
});

Deno.test("업무 설정 HTTP/MCP: 미저장 템플릿 기본값과 저장한 발급처 값·버전은 선택 조회에서도 유지", async () => {
  const { app, read } = fixture({
    versions: { entity_identity: 7, record_templates: 0 },
    settings: {
      entity_identity: {
        generation: "manual",
        default_source: "crm",
        sources: [
          { code: "crm", label: "고객", generation: "manual" },
          { code: "app", label: "앱", generation: "short" },
        ],
      },
    },
  });
  const templates = { settings: { record_templates: {} }, versions: { record_templates: 0 } };
  assertEquals(await (await app.request("/settings/business?id=record_templates")).json(), templates);
  assertEquals(await read.handler({ id: "record_templates" }, actor), templates);
  const identity = {
    settings: {
      entity_identity: {
        generation: "manual",
        default_source: "crm",
        sources: [
          { code: "crm", label: "고객", generation: "manual" },
          { code: "app", label: "앱", generation: "short" },
        ],
      },
    },
    versions: { entity_identity: 7 },
  };
  assertEquals(await (await app.request("/settings/business?id=entity_identity")).json(), identity);
  assertEquals(await read.handler({ id: "entity_identity" }, actor), identity);
});
