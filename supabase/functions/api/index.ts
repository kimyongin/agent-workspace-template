// 웹 HTTP API 진입점: /api/tasks, /api/records ...
import { createHttpApp } from "../_shared/adapters/http/app.ts";
import {
  activityDeps,
  businessSettingsDeps,
  createAndLinkDeps,
  dataModelDeps,
  entityDeps,
  entityIssuerDeps,
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
  entityIssuerDeps(),
  entityRelationDefinitionDeps(),
  entityRelationLinkDeps(),
  dataModelDeps(),
  createAndLinkDeps(),
);

Deno.serve(app.fetch);
