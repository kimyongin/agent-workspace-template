// 외부 에이전트용 MCP 진입점(Streamable HTTP). 토큰은 aud=MCP URL만 받는다.
import { createMcpApp } from "../_shared/adapters/mcp/app.ts";
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
  workspaceDeps,
} from "../_shared/bootstrap.ts";

const resource = env.mcpUrl();
Deno.serve(
  createMcpApp(
    activityDeps(),
    { resource, token: { audience: resource, issuer: env.authIssuer() }, allowedOrigins: env.webOrigins() },
    tagDeps(),
    searchDeps(),
    entityDeps(),
    businessSettingsDeps(),
    statusDeps(),
    entityTypeDeps(),
    entityIssuerDeps(),
    entityRelationDefinitionDeps(),
    entityRelationLinkDeps(),
    dataModelDeps(),
    createAndLinkDeps(),
    workspaceDeps(),
  ),
);
