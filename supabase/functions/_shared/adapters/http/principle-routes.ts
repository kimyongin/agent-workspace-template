import { Hono } from "hono";
import { principleCreate, principleListQuery } from "../../contracts/principle.ts";
import * as principles from "../../core/principles/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, idParam, json } from "./input.ts";

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
  return app;
}
