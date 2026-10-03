// 웹용 HTTP 진입점 조립: CORS → 인증(aud=authenticated) → 목적별 경로 → 오류 변환.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ActivityDeps } from "../../core/activity/application.ts";
import type { PrincipleDeps } from "../../core/principles/application.ts";
import { principleRoutes } from "./principle-routes.ts";
import { AppError } from "../../core/shared/errors.ts";
import { type TokenPolicy, verifyActor } from "../auth/verify.ts";
import { toErrorBody } from "../errors.ts";
import { activityRoutes } from "./activity-routes.ts";
import type { HttpEnv } from "./input.ts";
import type { TagDeps } from "../../core/tags/application.ts";
import { tagRoutes } from "./tag-routes.ts";
import type { SearchDeps } from "../../core/search/application.ts";
import { searchRoutes } from "./search-routes.ts";

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
  principles: PrincipleDeps,
  tags: TagDeps,
  search: SearchDeps,
  // Test assembly can inject an Actor verifier; production always defaults to token verification.
  authenticate: typeof verifyActor = verifyActor,
) {
  const app = new Hono<HttpEnv>().basePath(config.basePath);

  app.use(
    "*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", async (c, next) => {
    c.set("actor", await authenticate(c.req.raw, config.token));
    await next();
  });

  app.route("/", activityRoutes(deps));
  app.route("/", principleRoutes(principles));
  app.route("/", tagRoutes(tags));
  app.route("/", searchRoutes(search));

  app.notFound(() => {
    throw new AppError("not_found", "경로를 찾을 수 없습니다");
  });
  app.onError((e, c) => {
    const { status, body } = toErrorBody(e);
    const res = c.json(body, status as 400);
    if (status === 401) res.headers.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    return res;
  });
  return app;
}
