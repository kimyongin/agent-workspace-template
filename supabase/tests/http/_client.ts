// HTTP 계약 테스트 공통: 로컬 Supabase의 실제 진입점과 실제 로그인 토큰을 쓴다.
// 준비: npm run setup:local, 다른 터미널에서 npm run serve:functions.
import postgres from "postgres";

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}이 없습니다. npm run setup:local을 먼저 실행하세요`);
  return v;
}

export const SUPABASE_URL = env("VITE_SUPABASE_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) throw new Error("로컬 Supabase에서만 실행합니다");
export const API = `${SUPABASE_URL}/functions/v1/api`;

export async function signIn(who: "A" | "B"): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env("VITE_SUPABASE_PUBLISHABLE_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ email: env(`DEV_USER_${who}_EMAIL`), password: env(`DEV_USER_${who}_PASSWORD`) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`로그인 실패: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

// 응답 본문은 테스트에서 필드를 바로 읽으므로 느슨한 타입을 쓴다.
// deno-lint-ignore no-explicit-any
type Json = any;

export interface Res<T = Json> {
  status: number;
  body: T;
}

export async function call<T = Json>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res<T>> {
  // Fixture convenience: allocate identities for new objects, preserving explicit IDs for retry tests.
  if (
    method === "POST" &&
    /^\/(entities|tasks|records|principles|tags)$|^\/tasks\/[^/]+\/occurrences\/[^/]+\/records$/.test(path) && body &&
    typeof body === "object" && !("id" in body)
  ) {
    body = { id: crypto.randomUUID(), ...body };
  }
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** 판정용 관리 연결(로컬 전용). 큐·행 개수를 센다. */
export const admin = postgres(env("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });

export function httpTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

/** 할 일의 시간대(서울) 기준 오늘에서 days만큼 더한 날짜. */
export function seoulDate(days = 0): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);
}
