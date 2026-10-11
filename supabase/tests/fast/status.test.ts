import { z } from "zod";
import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { statusRoutes } from "../../functions/_shared/adapters/http/status-routes.ts";
import { statusTools } from "../../functions/_shared/adapters/mcp/status-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { StatusDeps } from "../../functions/_shared/core/status/application.ts";

Deno.test("status HTTP and readonly MCP share owner, server time, validated timezone and the same overview", async () => {
  let expectedTimezone = "Asia/Seoul";
  const actor = { userId: "status-owner" };
  const queried_at = "2026-10-10T15:00:00.000Z";
  const deps: StatusDeps = {
    clock: { now: () => new Date(queried_at) },
    reader: {
      issues: () => Promise.resolve([]),
      overview: (who, timezone, at) => {
        assertEquals(who.userId, "status-owner");
        assertEquals(timezone, expectedTimezone);
        assertEquals(at.toISOString(), queried_at);
        return Promise.resolve({
          period: { from: "2026-09-12", to: "2026-10-11", days: 30 },
          entities: { total: 0, active: 0, deleted: 0 },
          tasks: { total: 0, open: 0, done: 0, active: 0, stopped: 0 },
          records: { total: 0, user: 0, result: 0, change: 0 },
          indexing: {
            total: 0,
            indexed: 0,
            preparing: 0,
            attention: 0,
            excluded: 0,
            waiting: { long_waiting: 0, oldest_waiting_since: null, threshold_minutes: 15 },
          },
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
  for (const offset of ["+05:30", "-06:00"]) {
    assertEquals((await app.request(`/status?timezone=${encodeURIComponent(offset)}`)).status, 400);
    assertEquals(tool.input.safeParse({ timezone: offset }).success, false);
  }
  expectedTimezone = "America/Chicago";
  const canonical = await (await app.request("/status?timezone=CST")).json();
  assertEquals(canonical.timezone, "America/Chicago");
  assertEquals(await tool.handler({ timezone: "CST" }, actor), canonical);
  // Input transforms remain representable in the actual tools/list JSON Schema.
  const schema = z.toJSONSchema(tool.input, { io: "input", target: "draft-2020-12" });
  assertEquals((schema.properties?.timezone as { type: string }).type, "string");
});

Deno.test("indexing issues HTTP/MCP: fixed five-row page, same readonly result and strict input", async () => {
  const actor = { userId: "status-owner" };
  const deps = {
    clock: { now: () => new Date("2026-10-11T00:00:00Z") },
    reader: {
      overview: () => {
        throw Error("overview not requested");
      },
      issues: () =>
        Promise.resolve(Array.from({ length: 6 }, (_, n) => ({
          id: `20261011-ABCDEF${n}${n}`,
          created_at: "2026-10-11T00:00:00.000Z",
          title: "확인할 기록",
          reason: "provider_unknown" as const,
          attempts: 1,
          chunks: { total: 1, succeeded: 0, preparing: 0, unknown: 1, failed: 0 },
        }))),
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
  const response = await app.request("/status/indexing/issues");
  assertEquals(response.status, 200);
  const page = await response.json();
  assertEquals(page.items.length, 5);
  assertEquals(typeof page.next_cursor, "string");
  const tool = statusTools(deps).find((t) => t.name === "list_indexing_issues")!;
  assertEquals(tool.readOnly, true);
  assertEquals(await tool.handler({}, actor), page);
  for (const input of ["limit=6", "owner_id=other", "request_key=x", "cursor=invalid"]) {
    assertEquals((await app.request(`/status/indexing/issues?${input}`)).status, 400);
  }
  const foreign = { userId: "other-owner" };
  let rejected = false;
  try {
    await tool.handler({ cursor: page.next_cursor }, foreign);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
