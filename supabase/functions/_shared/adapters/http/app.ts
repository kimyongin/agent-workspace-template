import type { DataModelDeps } from "../../core/data-model/application.ts";
import { dataModelRoutes } from "./data-model-routes.ts";
import { createAndLinkRoutes } from "./create-and-link-routes.ts";
import type { CreateAndLinkDeps } from "../../core/entity-relations/create-and-link.ts";
import { entityRelationLinkRoutes } from "./entity-relation-link-routes.ts";
import type { EntityRelationLinkDeps } from "../../core/entity-relations/links.ts";
import type { EntityRelationDefinitionDeps } from "../../core/entity-relations/application.ts";
import { entityRelationDefinitionRoutes } from "./entity-relation-definition-routes.ts";
import { entityIssuerRoutes } from "./entity-issuer-routes.ts";
import type { EntityIssuerDeps } from "../../core/entity-issuers/application.ts";
import { entityTypeRoutes } from "./entity-type-routes.ts";
import type { EntityTypeDeps } from "../../core/entity-types/application.ts";
import type { StatusDeps } from "../../core/status/application.ts";
import { statusRoutes } from "./status-routes.ts";
// 웹용 HTTP 진입점 조립: CORS → 인증(aud=authenticated) → 목적별 경로 → 오류 변환.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ActivityDeps } from "../../core/activity/application.ts";
import { AppError } from "../../core/shared/errors.ts";
import { type TokenPolicy, verifyActor } from "../auth/verify.ts";
import { toErrorBody } from "../errors.ts";
import { activityRoutes } from "./activity-routes.ts";
import type { HttpEnv } from "./input.ts";
import type { TagDeps } from "../../core/tags/application.ts";
import { tagRoutes } from "./tag-routes.ts";
import type { SearchDeps } from "../../core/search/application.ts";
import { searchRoutes } from "./search-routes.ts";
import type { EntityDeps } from "../../core/entity/application.ts";
import { entityRoutes } from "./entity-routes.ts";
import { settingsRoutes } from "./settings-routes.ts";
import type { BusinessSettingsDeps } from "../../core/settings/application.ts";

export interface HttpConfig {
  /** 함수 이름에 해당하는 경로 접두어(Supabase Edge는 `/api/...`로 전달한다). */
  basePath: string;
  token: TokenPolicy;
  /** 브라우저 허용 origin. CORS는 인증이 아니며 서버 인증은 그대로 적용한다. */
  allowedOrigins: string[];
}

export function createHttpApp(
  deps: ActivityDeps,
  config: HttpConfig,
  tags: TagDeps,
  search: SearchDeps,
  // Test assembly can inject an Actor verifier; production always defaults to token verification.
  authenticate: typeof verifyActor = verifyActor,
  entities?: EntityDeps,
  settings?: BusinessSettingsDeps,
  status?: StatusDeps,
  entityTypes?: EntityTypeDeps,
  issuers?: EntityIssuerDeps,
  relationDefinitions?: EntityRelationDefinitionDeps,
  relationLinks?: EntityRelationLinkDeps,
  dataModel?: DataModelDeps,
  createAndLink?: CreateAndLinkDeps,
) {
  const app = new Hono<HttpEnv>().basePath(config.basePath);

  app.use(
    "*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type", "Idempotency-Key"],
      exposeHeaders: ["Idempotency-Replayed", "Idempotency-Completed-At", "Retry-After"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", async (c, next) => {
    const actor = {
      ...await authenticate(c.req.raw, config.token),
      source: "http" as const,
      request: {
        key: c.req.header("Idempotency-Key") ?? "",
        replayed: false,
        completed_at: undefined as string | undefined,
      },
    };
    c.set("actor", actor);
    await next();
    if (actor.request.replayed) {
      c.header("Idempotency-Replayed", "true");
      if (actor.request.completed_at) c.header("Idempotency-Completed-At", actor.request.completed_at);
    }
  });

  app.route("/", activityRoutes(deps));
  app.route("/", tagRoutes(tags));
  app.route("/", searchRoutes(search));
  if (entities) app.route("/", entityRoutes(entities));
  if (settings) app.route("/", settingsRoutes(settings));
  if (status) app.route("/", statusRoutes(status));
  if (dataModel) app.route("/", dataModelRoutes(dataModel));
  if (createAndLink) app.route("/", createAndLinkRoutes(createAndLink));
  if (relationLinks) app.route("/", entityRelationLinkRoutes(relationLinks));
  if (relationDefinitions) app.route("/", entityRelationDefinitionRoutes(relationDefinitions));
  if (issuers) app.route("/", entityIssuerRoutes(issuers));
  if (entityTypes) app.route("/", entityTypeRoutes(entityTypes));

  app.notFound(() => {
    throw new AppError("not_found", "경로를 찾을 수 없습니다");
  });
  app.onError((e, c) => {
    const { status, body } = toErrorBody(e);
    const res = c.json(body, status as 400);
    if (body.code === "request_in_progress") res.headers.set("Retry-After", "1");
    if (status === 401) res.headers.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    return res;
  });
  return app;
}
