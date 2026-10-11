import { Hono } from "hono";
import { indexingIssuesInput, statusInput } from "../../contracts/status.ts";
import { getStatus, listIndexingIssues, type StatusDeps } from "../../core/status/application.ts";
import { parse } from "../errors.ts";
import type { HttpEnv } from "./input.ts";
export function statusRoutes(d: StatusDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/status", async (c) => c.json(await getStatus(d, c.get("actor"), parse(statusInput, c.req.query()))));
  app.get(
    "/status/indexing/issues",
    async (c) => c.json(await listIndexingIssues(d, c.get("actor"), parse(indexingIssuesInput, c.req.query()))),
  );
  return app;
}
