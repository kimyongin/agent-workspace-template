// 웹 HTTP API 진입점: /api/tasks, /api/records ...
import { createHttpApp } from "../_shared/adapters/http/app.ts";
import {
  activityDeps,
  businessSettingsDeps,
  entityDeps,
  entityIssuerDeps,
  entityPairDeps,
  entityRelationDefinitionDeps,
  entityRelationLinkDeps,
  entityTypeDeps,
  env,
  searchDeps,
  statusDeps,
  tagDeps,
} from "../_shared/bootstrap.ts";

const app = createHttpApp(
  activityDeps(),
  {
    basePath: "/api",
    token: { audience: "authenticated", issuer: env.authIssuer() },
    allowedOrigins: env.webOrigins(),
  },
  tagDeps(),
  searchDeps(),
  undefined,
  entityDeps(),
  businessSettingsDeps(),
  statusDeps(),
  entityTypeDeps(),
  entityPairDeps(),
  entityIssuerDeps(),
  entityRelationDefinitionDeps(),
  entityRelationLinkDeps(),
);

Deno.serve(app.fetch);
