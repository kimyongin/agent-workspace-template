// 로컬 개발 환경 준비: 서명 키 생성 → 로컬 Supabase 시작 → 로컬 설정 파일과 개발용 사용자 생성.
// 로컬 전용이며 운영·호스팅 프로젝트를 건드리지 않는다. 다시 실행해도 기존 키·비밀번호를 유지한다.
// 사용: node scripts/local-setup.mjs
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

function writeEnv(file, header, values) {
  const lines = [`# ${header}`, ...Object.entries(values).map(([k, v]) => `${k}=${v}`), ""];
  writeFileSync(file, lines.join("\n"));
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

// 2. 로컬 Supabase. 쓰지 않는 서비스는 띄우지 않는다.
supabase(["start", "-x", "studio,imgproxy,vector,logflare,mailpit,realtime,storage-api"], { inherit: true });
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
  DEV_USER_A_EMAIL: "dev-a@example.test",
  DEV_USER_A_PASSWORD: prev.DEV_USER_A_PASSWORD ?? secret(),
  DEV_USER_B_EMAIL: "dev-b@example.test",
  DEV_USER_B_PASSWORD: prev.DEV_USER_B_PASSWORD ?? secret(),
};
writeEnv(path(".env.local"), "로컬 전용. scripts/local-setup.mjs가 만든다. 커밋하지 않는다.", local);

// 4. 개발용 사용자(A·B). 이미 있으면 비밀번호만 맞춘다.
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
