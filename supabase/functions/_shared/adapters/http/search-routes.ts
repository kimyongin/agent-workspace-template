import { Hono } from "hono";
import { searchInput } from "../../contracts/search.ts";
import { search, type SearchDeps } from "../../core/search/application.ts";
import { parse } from "../errors.ts";
import { type HttpEnv, json } from "./input.ts";
export function searchRoutes(d: SearchDeps) {
  const app = new Hono<HttpEnv>();
  app.post("/search", async (c) => c.json(await search(d, c.get("actor"), parse(searchInput, await json(c.req.raw)))));
  return app;
}
