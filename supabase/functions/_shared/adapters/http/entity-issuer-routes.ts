import { Hono } from "hono";
import {
  createEntityIssuer,
  createIdentifierRule,
  deleteEntityIssuer,
  deleteIdentifierRule,
  type EntityIssuerDeps,
  getEntityTypeIdentity,
  listEntityIssuers,
  listIdentifierRules,
  updateEntityIssuer,
  updateEntityTypeIdentity,
  updateIdentifierRule,
} from "../../core/entity-issuers/application.ts";
import { type HttpEnv, json } from "./input.ts";
export function entityIssuerRoutes(d: EntityIssuerDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/entity-issuers", async (c) => c.json(await listEntityIssuers(d, c.get("actor"))));
  app.post(
    "/entity-issuers",
    async (c) => c.json(await createEntityIssuer(d, c.get("actor"), await json(c.req.raw)), 201),
  );
  app.patch(
    "/entity-issuers/:code",
    async (c) => c.json(await updateEntityIssuer(d, c.get("actor"), c.req.param("code"), await json(c.req.raw))),
  );
  app.get(
    "/entity-issuers/:code/rules",
    async (c) => c.json(await listIdentifierRules(d, c.get("actor"), c.req.param("code"))),
  );
  app.post(
    "/entity-issuers/:code/rules",
    async (c) => c.json(await createIdentifierRule(d, c.get("actor"), c.req.param("code"), await json(c.req.raw)), 201),
  );
  app.patch(
    "/entity-identifier-rules/:rule_id",
    async (c) => c.json(await updateIdentifierRule(d, c.get("actor"), c.req.param("rule_id"), await json(c.req.raw))),
  );
  app.delete(
    "/entity-issuers/:code",
    async (c) => c.json(await deleteEntityIssuer(d, c.get("actor"), c.req.param("code"), await json(c.req.raw))),
  );
  app.delete(
    "/entity-identifier-rules/:rule_id",
    async (c) => c.json(await deleteIdentifierRule(d, c.get("actor"), c.req.param("rule_id"), await json(c.req.raw))),
  );
  app.get(
    "/entity-types/:type_id/identity",
    async (c) => c.json(await getEntityTypeIdentity(d, c.get("actor"), c.req.param("type_id"))),
  );
  app.patch(
    "/entity-types/:type_id/identity",
    async (c) =>
      c.json(await updateEntityTypeIdentity(d, c.get("actor"), c.req.param("type_id"), await json(c.req.raw))),
  );
  return app;
}
