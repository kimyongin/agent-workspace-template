import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { statusRoutes } from "../../functions/_shared/adapters/http/status-routes.ts";
import { statusTools } from "../../functions/_shared/adapters/mcp/status-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { StatusDeps } from "../../functions/_shared/core/status/application.ts";

Deno.test("status HTTP and readonly MCP share owner, server time, validated timezone and the same overview", async () => {
  const actor = { userId: "status-owner" };
  const queried_at = "2026-10-10T15:00:00.000Z";
  const deps: StatusDeps = {
    clock: { now: () => new Date(queried_at) },
    reader: {
      overview: (who, timezone, at) => {
        assertEquals(who.userId, "status-owner");
        assertEquals(timezone, "Asia/Seoul");
        assertEquals(at.toISOString(), queried_at);
        return Promise.resolve({
          period: { from: "2026-09-12", to: "2026-10-11", days: 30 },
          entities: { total: 0, active: 0, deleted: 0 },
          tasks: { total: 0, open: 0, done: 0, active: 0, stopped: 0 },
          records: { total: 0, user: 0, result: 0, change: 0 },
          indexing: { total: 0, indexed: 0, preparing: 0, attention: 0, excluded: 0 },
          daily: [],
        });
      },
    },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", statusRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const response = await app.request("/status");
  assertEquals(response.status, 200);
  const overview = await response.json();
  assertEquals(overview.queried_at, queried_at);
  assertEquals(overview.timezone, "Asia/Seoul");
  const tool = statusTools(deps)[0];
  assertEquals(tool.name, "get_status");
  assertEquals(tool.readOnly, true);
  assertEquals(await tool.handler({}, actor), overview);
  assertEquals((await app.request("/status?timezone=not-a-timezone")).status, 400);
  assertEquals((await app.request("/status?owner_id=someone-else")).status, 400);
  assertEquals(tool.input.safeParse({ request_key: crypto.randomUUID() }).success, false);
});
