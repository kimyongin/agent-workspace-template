import { Hono } from "hono";
import {
  type BusinessSettingsDeps,
  getBusinessSettings,
  prepareBusinessRecord,
  updateBusinessSettings,
} from "../../core/settings/application.ts";
import { type HttpEnv, json } from "./input.ts";
export function settingsRoutes(deps: BusinessSettingsDeps) {
  const app = new Hono<HttpEnv>();
  app.get("/settings/business", async (c) => c.json(await getBusinessSettings(deps, c.get("actor"))));
  app.patch(
    "/settings/business",
    async (c) => c.json(await updateBusinessSettings(deps, c.get("actor"), await json(c.req.raw))),
  );
  app.post(
    "/records/prepare",
    async (c) => c.json(await prepareBusinessRecord(deps, c.get("actor"), await json(c.req.raw))),
  );
  return app;
}
