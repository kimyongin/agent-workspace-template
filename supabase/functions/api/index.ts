// 웹 HTTP API 진입점: /api/tasks, /api/records ...
import { createHttpApp } from "../_shared/adapters/http/app.ts";
import { activityDeps, env, principleDeps, searchDeps, tagDeps } from "../_shared/bootstrap.ts";

const app = createHttpApp(
  activityDeps(),
  {
    basePath: "/api",
    token: { audience: "authenticated", issuer: env.authIssuer() },
    allowedOrigins: env.webOrigins(),
  },
  principleDeps(),
  tagDeps(),
  searchDeps(),
);

Deno.serve(app.fetch);
