// 실행 환경에서 실제 구현을 조립한다. 요청마다 Actor는 진입점이 검증해 유스케이스에 넘긴다.
import postgres from "postgres";
import { SqlUnitOfWork } from "./adapters/supabase/activity-store.ts";
import type { ActivityDeps } from "./core/activity/application.ts";

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`환경변수 ${name}이 필요합니다`);
  return v;
}

let deps: ActivityDeps | undefined;

/** 트랜잭션 풀러(Supavisor) 연결. prepared statement를 지원하지 않으므로 prepare: false. */
export function activityDeps(): ActivityDeps {
  if (!deps) {
    const sql = postgres(required("APP_DB_URL"), { prepare: false, max: 3, idle_timeout: 20, onnotice: () => {} });
    deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
  }
  return deps;
}

export const env = {
  /** 토큰 발급자(Supabase Auth의 공개 주소 + /auth/v1). */
  authIssuer: () => required("AUTH_ISSUER"),
  /** MCP 서버의 정식 URL(토큰 audience). Custom Access Token Hook의 mcp_audience와 같아야 한다. */
  mcpUrl: () => required("MCP_URL"),
  webOrigins: () => (Deno.env.get("WEB_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};
