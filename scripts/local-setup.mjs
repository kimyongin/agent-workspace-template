// 로컬 개발 환경 준비: 서명 키 생성 → 로컬 Supabase 시작 → 로컬 설정 파일과 개발용 사용자 생성.
// 로컬 전용이며 운영·호스팅 프로젝트를 건드리지 않는다. 다시 실행해도 기존 키·비밀번호를 유지한다.
// 사용: node scripts/local-setup.mjs
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { readEnv, writeEnv } from "./local-env.mjs";

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root);

function supabase(args, opts = {}) {
  // 인자는 이 파일의 고정 값뿐이라 셸 문자열로 합쳐도 안전하다(Windows의 npx.cmd 실행용).
  return execSync(`npx supabase ${args.join(" ")}`, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "inherit"],
  });
}

const secret = () => randomBytes(18).toString("base64url");

// 1. 비대칭 서명 키(ES256). MCP·HTTP의 JWKS 검증에 필요하다.
const keysFile = path("supabase/signing_keys.json");
if (!existsSync(keysFile)) {
  // CLI가 설정의 키 파일을 먼저 읽으므로 빈 목록을 만든 뒤 추가한다.
  writeFileSync(keysFile, "[]");
  supabase(["gen", "signing-key", "--algorithm", "ES256", "--append"]);
  console.log("서명 키를 만들었습니다: supabase/signing_keys.json");
}

// Google 로그인: supabase/.env(커밋하지 않음)에 클라이언트 값이 있으면 켠다. 없으면 이메일 개발용 로그인만 쓴다.
const authEnv = readEnv(path("supabase/.env"));
if (authEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID && authEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET) {
  process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED = "true";
  console.log("Google 로그인을 켭니다(supabase/.env). 이미 실행 중이면 npm run stop:local 뒤 다시 실행해야 반영됩니다.");
}

// 2. 로컬 Supabase. 쓰지 않는 서비스는 띄우지 않는다.
// CLI start의 stdout에는 로컬 secret key가 포함되므로 일반 로그에 출력하지 않는다.
supabase(["start", "-x", "studio,imgproxy,vector,logflare,mailpit,realtime,storage-api"]);
// 이미 떠 있던 로컬 DB에도 새 migration을 적용한다(새로 시작하면 start가 적용한다).
supabase(["migration", "up", "--local"], { inherit: true });
const status = Object.fromEntries(
  supabase(["status", "-o", "env"])
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const apiUrl = status.API_URL;
const publishable = status.PUBLISHABLE_KEY;
const secretKey = status.SECRET_KEY;
if (!apiUrl || !publishable || !secretKey) throw new Error("supabase status에서 API_URL·PUBLISHABLE_KEY·SECRET_KEY를 찾지 못했습니다");

// 3. 웹·시험용 설정(.env.local). 개발용 사용자 비밀번호는 처음 만든 값을 유지한다.
const prev = readEnv(path(".env.local"));
const local = {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
  VITE_API_URL: `${apiUrl}/functions/v1/api`,
  VITE_DEV_LOGIN: "true",
  LOCAL_SUPABASE_SECRET_KEY: secretKey,
  LOCAL_DB_URL: status.DB_URL,
  APP_SERVER_PASSWORD: prev.APP_SERVER_PASSWORD ?? secret(),
  DEV_USER_A_EMAIL: "dev-a@example.test",
  DEV_USER_A_PASSWORD: prev.DEV_USER_A_PASSWORD ?? secret(),
  DEV_USER_B_EMAIL: "dev-b@example.test",
  DEV_USER_B_PASSWORD: prev.DEV_USER_B_PASSWORD ?? secret(),
};
writeEnv(path(".env.local"), "로컬 전용. scripts/local-setup.mjs가 만든다. 커밋하지 않는다.", local);

// 4. 서버 접속 역할(app_server)의 로컬 비밀번호와 Edge Functions용 설정.
// 같은 값이어도 다시 설정하면 비밀번호 해시가 바뀌어 트랜잭션 풀러가 한동안 예전 값으로 인증을 거부한다(28P01).
// 그래서 저장된 비밀번호로 접속이 안 될 때(처음·DB 초기화 뒤)만 설정한다.
const db = postgres(status.DB_URL, { max: 1, onnotice: () => {} });
const direct = new URL(status.DB_URL);
direct.username = "app_server";
direct.password = encodeURIComponent(local.APP_SERVER_PASSWORD);
const probe = postgres(direct.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
const loginOk = await probe`select 1`.then(() => true, () => false);
await probe.end();
if (!loginOk) {
  await db.unsafe(`alter role app_server password '${local.APP_SERVER_PASSWORD.replace(/'/g, "''")}'`);
  // 풀러가 새 비밀번호로 인증할 때까지 기다린다(설정 직후 테스트가 28P01로 실패하지 않게).
  const pooler = new URL(direct.href);
  pooler.username = "app_server.pooler-dev";
  pooler.port = "55429";
  for (let i = 0; i < 30; i++) {
    const p = postgres(pooler.href, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => {} });
    const ok = await p`select 1`.then(() => true, () => false);
    await p.end();
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const mcpUrl = `${apiUrl}/functions/v1/mcp`;
await db`
  insert into private.auth_settings (key, value) values ('mcp_audience', ${mcpUrl})
  on conflict (key) do update set value = excluded.value`;
await db.end();
// SUPABASE_로 시작하는 이름은 CLI가 함수에 넘기지 않는다. SUPABASE_URL 등은 CLI가 직접 넣고,
// 토큰 검증 키(JWKS)는 @supabase/server가 그 주소에서 가져온다.
writeEnv(path("supabase/functions/.env"), "로컬 전용. scripts/local-setup.mjs가 만든다. 커밋하지 않는다.", {
  // Edge Runtime 컨테이너에서 본 트랜잭션 풀러 주소(prepare: false로 연결).
  APP_DB_URL: `postgresql://app_server.pooler-dev:${local.APP_SERVER_PASSWORD}@pooler:6543/postgres`,
  AUTH_ISSUER: `${apiUrl}/auth/v1`,
  MCP_URL: mcpUrl,
  WEB_ORIGINS: "http://127.0.0.1:55480,http://localhost:55480",
});

// 5. 개발용 사용자(A·B). 이미 있으면 비밀번호만 맞춘다.
const admin = (p, init = {}) =>
  fetch(`${apiUrl}/auth/v1/admin${p}`, {
    ...init,
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
  });
const { users = [] } = await (await admin("/users?per_page=1000")).json();
for (const who of ["A", "B"]) {
  const email = local[`DEV_USER_${who}_EMAIL`];
  const password = local[`DEV_USER_${who}_PASSWORD`];
  const found = users.find((u) => u.email === email);
  const res = found
    ? await admin(`/users/${found.id}`, { method: "PUT", body: JSON.stringify({ password }) })
    : await admin("/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!res.ok) throw new Error(`개발용 사용자 ${email} 준비 실패: ${res.status} ${await res.text()}`);
}

console.log(`로컬 준비 완료. Supabase ${apiUrl}, 개발용 사용자 계정은 .env.local에 있습니다.`);
