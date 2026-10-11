import { Hono } from "hono";
import { entityCreate, entityListQuery, entityUpdate } from "../../contracts/entity.ts";
import { businessMeta } from "../../contracts/change.ts";
import { expectedVersion } from "../../contracts/common.ts";
import { z } from "zod";
import * as entity from "../../core/entity/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, json } from "./input.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { notFound } from "../../core/shared/errors.ts";
function idParam(value: string) {
  const parsed = entityReferenceId.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}
export function entityRoutes(d: entity.EntityDeps) {
  const app = new Hono<HttpEnv>();
  app.post("/entities/:id/delete", async (c) => {
    const i = parse(z.strictObject({ expected_version: expectedVersion, ...businessMeta }), await json(c.req.raw));
    await entity.deleteEntity(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      i.expected_version,
      i.change_note,
      i.change_tag_ids,
    );
    return c.body(null, 204);
  });
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
  return app;
}
