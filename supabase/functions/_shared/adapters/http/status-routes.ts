import { Hono } from "hono";
import { statusInput } from "../../contracts/status.ts";
import { getStatus, type StatusDeps } from "../../core/status/application.ts";
import { parse } from "../errors.ts";
import type { HttpEnv } from "./input.ts";
export function statusRoutes(d: StatusDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/status", async (c) => c.json(await getStatus(d, c.get("actor"), parse(statusInput, c.req.query()))));
  return app;
}
