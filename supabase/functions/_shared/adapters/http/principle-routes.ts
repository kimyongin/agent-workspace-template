import { Hono } from "hono";
import {
  principleCreate,
  principleDelete,
  principlePreview,
  principleSave,
  principleUpdate,
} from "../../contracts/principle.ts";
import * as principles from "../../core/principles/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, idParam, json, versionQuery } from "./input.ts";
export function principleRoutes(d: principles.PrincipleDeps) {
  const app = new Hono<HttpEnv>();
  app.post(
    "/principles/preview",
    async (c) =>
      c.json(
        await principles.previewPrincipleChange(d, c.get("actor"), parse(principlePreview, await json(c.req.raw))),
      ),
  );
  app.post("/principles/:id/delete", async (c) => {
    const i = parse(principleDelete, await json(c.req.raw));
    await principles.deletePrinciple(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      i.expected_version,
      i.change_note,
      i.request_id,
      i.change_memo,
    );
    return c.body(null, 204);
  });
  app.get("/principles/current", async (c) => c.json(await principles.currentPrinciple(d, c.get("actor"))));
  app.post(
    "/principles/current",
    async (c) =>
      c.json(
        await principles.saveCurrentPrinciple(d, c.get("actor"), parse(principleSave, await json(c.req.raw))),
        201,
      ),
  );
  app.post(
    "/principles",
    async (c) =>
      c.json(await principles.createPrinciple(d, c.get("actor"), parse(principleCreate, await json(c.req.raw))), 201),
  );
  app.get(
    "/principles/:id",
    async (c) => c.json(await principles.getPrinciple(d, c.get("actor"), idParam(c.req.param("id")))),
  );
  app.patch(
    "/principles/:id",
    async (c) =>
      c.json(
        await principles.updatePrinciple(
          d,
          c.get("actor"),
          idParam(c.req.param("id")),
          parse(principleUpdate, await json(c.req.raw)),
        ),
      ),
  );
  app.delete("/principles/:id", async (c) => {
    const i = parse(versionQuery, c.req.query());
    await principles.deletePrinciple(
      d,
      c.get("actor"),
      idParam(c.req.param("id")),
      i.expected_version,
      i.change_note,
      i.request_id,
    );
    return c.body(null, 204);
  });
  return app;
}
