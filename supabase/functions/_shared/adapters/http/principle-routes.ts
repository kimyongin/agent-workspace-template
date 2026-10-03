import { Hono } from "hono";
import { principleCreate, principleListQuery, principleStatus, principleUpdate } from "../../contracts/principle.ts";
import * as principles from "../../core/principles/application.ts";
import { z } from "zod";
import { parse } from "../errors.ts";
import { type HttpEnv, idParam, json, versionQuery } from "./input.ts";

export function principleRoutes(deps: principles.PrincipleDeps) {
  const app = new Hono<HttpEnv>();
  app.post("/principles", async (c) => {
    const input = await json(c.req.raw);
    return c.json(await principles.createPrinciple(deps, c.get("actor"), parse(principleCreate, input)), 201);
  });
  app.get(
    "/principles",
    async (c) =>
      c.json(await principles.listPrinciples(deps, c.get("actor"), parse(principleListQuery, c.req.query()))),
  );
  app.get("/principles/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    return c.json(await principles.getPrinciple(deps, c.get("actor"), id));
  });
  app.patch(
    "/principles/:id",
    async (c) =>
      c.json(
        await principles.updatePrinciple(
          deps,
          c.get("actor"),
          idParam(c.req.param("id")),
          parse(principleUpdate, await json(c.req.raw)),
        ),
      ),
  );
  for (const [action, status] of [["activate", "active"], ["deactivate", "inactive"]] as const) {
    app.post("/principles/:id/" + action, async (c) => {
      const schema = z.strictObject({ ...principleStatus.shape }).omit({ status: true });
      const raw = await json(c.req.raw);
      // The route supplies status. Reject a caller status/non-object before injecting it,
      // then let the original contract report field and status-refinement issues together.
      if (typeof raw !== "object" || raw === null || Array.isArray(raw) || "status" in raw) parse(schema, raw);
      const input = parse(principleStatus, { ...raw as Record<string, unknown>, status });
      return c.json(
        await principles.setPrincipleStatus(
          deps,
          c.get("actor"),
          idParam(c.req.param("id") ?? ""),
          input,
        ),
      );
    });
  }
  app.delete("/principles/:id", async (c) => {
    const input = parse(versionQuery, c.req.query());
    await principles.deletePrinciple(deps, c.get("actor"), idParam(c.req.param("id")), input.expected_version);
    return c.body(null, 204);
  });
  return app;
}
