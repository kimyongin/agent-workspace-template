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
  versions: { record_templates: 4 },
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
Deno.test("업무 설정 HTTP/MCP: 기록 템플릿 선택·선택 생략 전체·잘못된 선택자 거절", async () => {
  const { app, read } = fixture();
  const templates = {
    versions: { record_templates: 4 },
    settings: { record_templates: { task: { create: { memo: "추가", tag_ids: [] } } } },
  };
  assertEquals(await (await app.request("/settings/business?id=record_templates")).json(), templates);
  assertEquals(await read.handler({ id: "record_templates" }, actor), templates);
  const full = {
    versions: { record_templates: 4 },
    settings: {
      record_templates: { task: { create: { memo: "추가", tag_ids: [] } } },
    },
  };
  assertEquals(await (await app.request("/settings/business")).json(), full);
  assertEquals(await read.handler({}, actor), full);
  for (const id of ["", "unknown", "entity_identity", "ENTITY_IDENTITY"]) {
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
