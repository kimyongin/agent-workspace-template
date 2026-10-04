// 격리 DB 테스트 공통: 로컬 Supabase에만 접속한다(npm run setup:local이 만든 .env.local).
import postgres from "postgres";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}이 없습니다. npm run setup:local을 먼저 실행하세요`);
  return v;
}

const adminUrl = env("LOCAL_DB_URL");
const host = new URL(adminUrl).hostname;
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("DB 테스트는 로컬 DB에서만 실행합니다");

const password = encodeURIComponent(env("APP_SERVER_PASSWORD"));
const dbPort = new URL(adminUrl).port;
export const urls = {
  admin: adminUrl,
  direct: `postgresql://app_server:${password}@${host}:${dbPort}/postgres`,
  pooler: `postgresql://app_server.pooler-dev:${password}@${host}:${
    Deno.env.get("LOCAL_POOLER_PORT") ?? 55429
  }/postgres`,
};

export function connect(url: string, opts: postgres.Options<Record<string, never>> = {}) {
  return postgres(url, { onnotice: () => {}, ...opts });
}

/** 트랜잭션 한정으로 Actor 문맥을 넣고 app_user로 전환한다(아키텍처의 채택 방식). */
export function asUser<T>(sql: postgres.Sql, sub: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: "authenticated" })}, true)`;
    await tx`set local role app_user`;
    return fn(tx);
  }) as Promise<T>;
}

export async function devUsers(admin: postgres.Sql): Promise<{ a: string; b: string }> {
  const rows = await admin<{ id: string; email: string }[]>`
    select id, email from auth.users where email in (${env("DEV_USER_A_EMAIL")}, ${env("DEV_USER_B_EMAIL")})`;
  const a = rows.find((r) => r.email === env("DEV_USER_A_EMAIL"))?.id;
  const b = rows.find((r) => r.email === env("DEV_USER_B_EMAIL"))?.id;
  if (!a || !b) throw new Error("개발용 사용자 A·B가 없습니다. npm run setup:local을 실행하세요");
  return { a, b };
}

/** 실패한 쿼리의 SQLSTATE와 메시지. 성공하면 "ok". */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? "?"} ${err.message ?? String(e)}`;
  }
}

/** 모듈 공용 관리 연결을 테스트 사이에 재사용하므로 자원 검사(sanitizer)를 끈다. */
export function dbTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

/** A test owns this whole account; cleanup never selects unrelated rows. */
export async function fixtureOwner(admin: postgres.Sql) {
  const userId = crypto.randomUUID();
  await admin`insert into auth.users(id,email) values(${userId},${`template20-${userId}@example.test`})`;
  return {
    actor: { userId },
    cleanup: async () => {
      await admin`delete from pgmq.q_search_index where message->>'owner_id'=${userId}`;
      await admin`delete from auth.users where id=${userId}`;
    },
  };
}
