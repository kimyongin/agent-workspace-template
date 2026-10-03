// 실행 환경에서 실제 구현을 조립한다. 요청마다 Actor는 진입점이 검증해 유스케이스에 넘긴다.
import postgres from "postgres";
import { SqlUnitOfWork } from "./adapters/supabase/activity-store.ts";
import type { ActivityDeps } from "./core/activity/application.ts";
import { SqlPrincipleUnitOfWork } from "./adapters/supabase/principle-store.ts";
import type { PrincipleDeps } from "./core/principles/application.ts";
import { SqlTagUnitOfWork } from "./adapters/supabase/tag-store.ts";
import type { TagDeps } from "./core/tags/application.ts";
import type { SearchDeps } from "./core/search/application.ts";
import { SqlSearchUnitOfWork } from "./adapters/supabase/search-store.ts";

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`환경변수 ${name}이 필요합니다`);
  return v;
}

let deps: ActivityDeps | undefined;
let principles: PrincipleDeps | undefined;
let connection: postgres.Sql | undefined;
let tags: TagDeps | undefined;
let search: SearchDeps | undefined;
export function searchDeps(): SearchDeps {
  return search ??= { uow: new SqlSearchUnitOfWork(database()) };
}
export function tagDeps(): TagDeps {
  return tags ??= { uow: new SqlTagUnitOfWork(database()) };
}
function database() {
  return connection ??= postgres(required("APP_DB_URL"), {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    onnotice: () => {},
  });
}
export function principleDeps(): PrincipleDeps {
  return principles ??= { uow: new SqlPrincipleUnitOfWork(database()) };
}

/** 트랜잭션 풀러(Supavisor) 연결. prepared statement를 지원하지 않으므로 prepare: false. */
export function activityDeps(): ActivityDeps {
  if (!deps) {
    const sql = database();
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
