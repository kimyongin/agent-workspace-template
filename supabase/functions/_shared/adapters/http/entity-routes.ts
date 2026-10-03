import { Hono } from "hono";
import { entityCreate, entityListQuery, entityUpdate } from "../../contracts/entity.ts";
import * as entity from "../../core/entity/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, idParam, json, versionQuery } from "./input.ts";
export function entityRoutes(d: entity.EntityDeps) {
  const app = new Hono<HttpEnv>();
  app.get(
    "/entities",
    async (c) => c.json(await entity.listEntities(d, c.get("actor"), parse(entityListQuery, c.req.query()))),
  );
  app.get("/entities/:id", async (c) => c.json(await entity.getEntity(d, c.get("actor"), idParam(c.req.param("id")))));
  app.post(
    "/entities",
    async (c) => c.json(await entity.createEntity(d, c.get("actor"), parse(entityCreate, await json(c.req.raw))), 201),
  );
  app.patch(
    "/entities/:id",
    async (c) =>
      c.json(
        await entity.updateEntity(
          d,
          c.get("actor"),
          idParam(c.req.param("id")),
          parse(entityUpdate, await json(c.req.raw)),
        ),
      ),
  );
  app.delete("/entities/:id", async (c) => {
    await entity.deleteEntity(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      parse(versionQuery, c.req.query()).expected_version,
    );
    return c.body(null, 204);
  });
  return app;
}
