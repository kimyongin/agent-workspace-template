// 웹용 HTTP 진입점 조립: CORS → 인증(aud=authenticated) → 목적별 경로 → 오류 변환.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ActivityDeps } from "../../core/activity/application.ts";
import { AppError } from "../../core/shared/errors.ts";
import { type TokenPolicy, verifyActor } from "../auth/verify.ts";
import { toErrorBody } from "../errors.ts";
import { activityRoutes, type HttpEnv } from "./activity-routes.ts";

export interface HttpConfig {
  /** 함수 이름에 해당하는 경로 접두어(Supabase Edge는 `/api/...`로 전달한다). */
  basePath: string;
  token: TokenPolicy;
  /** 브라우저 허용 origin. CORS는 인증이 아니며 서버 인증은 그대로 적용한다. */
  allowedOrigins: string[];
}

export function createHttpApp(deps: ActivityDeps, config: HttpConfig) {
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
    c.set("actor", await verifyActor(c.req.raw, config.token));
    await next();
  });

  app.route("/", activityRoutes(deps));

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
