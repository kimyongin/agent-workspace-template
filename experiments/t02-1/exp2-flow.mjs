// T02-1 실험 2: MCP 클라이언트처럼 탐색 → 동적 등록 → PKCE 인가 → 토큰 → 교차 호출을 수행한다.
// 격리 로컬 Supabase 전용. 사용: node exp2-flow.mjs  (인가 URL이 authorize-url.txt에 기록되면 브라우저로 승인)

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const env = Object.fromEntries(
  readFileSync(new URL(".env.local", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const BASE = "http://127.0.0.1:55321";
const MCP = `${BASE}/functions/v1/exp2-mcp`;
const API = `${BASE}/functions/v1/exp2-api`;
const REDIRECT = "http://127.0.0.1:55390/callback";
const results = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass, detail });
const b64url = (b) => b.toString("base64url");
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

async function mcpCall(token) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const init = await fetch(MCP, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "exp2-flow", version: "0" } },
    }),
  });
  if (init.status !== 200) return { status: init.status };
  const res = await fetch(MCP, {
    method: "POST",
    headers: { ...headers, "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
  const text = await res.text();
  const json = JSON.parse(text.includes("data:") ? text.split("data:").pop() : text);
  return { status: res.status, claims: JSON.parse(json.result?.content?.[0]?.text ?? "null") };
}

const apiCall = async (token) => (await fetch(API, { headers: { authorization: `Bearer ${token}` } })).status;

// 1. 탐색
const unauth = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const rm = /resource_metadata="([^"]+)"/.exec(unauth.headers.get("www-authenticate") ?? "")?.[1];
check("D1", "토큰 없는 MCP 요청은 401과 resource_metadata", unauth.status === 401 && !!rm, rm);
const prm = await (await fetch(rm)).json();
check("D2", "보호 자원 metadata의 resource가 MCP URL", prm.resource === MCP, JSON.stringify(prm));
const issuer = prm.authorization_servers[0];
const insert = await fetch(`${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`);
const append = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
check("D3", "권한 서버 metadata(경로 삽입형/덧붙임형)", append.status === 200, `insert ${insert.status}, append ${append.status}`);
const as = await append.json();

// 2. 동적 등록: loopback, claude.ai callback, 임의 HTTP
async function register(redirect) {
  const r = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "exp2-flow", redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    }),
  });
  return { status: r.status, body: await r.json() };
}
const reg = await register(REDIRECT);
check("R1", "loopback redirect로 동적 등록", reg.status === 201 || reg.status === 200, `${reg.status} client_id=${reg.body.client_id}`);
const regClaude = await register("https://claude.ai/api/mcp/auth_callback");
check("R2", "claude.ai HTTPS callback으로 동적 등록", regClaude.status < 300, `${regClaude.status}`);
const regHttp = await register("http://attacker.example/callback");
check("R3", "loopback이 아닌 HTTP redirect 등록 거부", regHttp.status >= 400, `${regHttp.status} ${JSON.stringify(regHttp.body).slice(0, 120)}`);

// 3. PKCE 인가
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));
const authorize = new URL(as.authorization_endpoint);
for (const [k, v] of Object.entries({
  response_type: "code", client_id: reg.body.client_id, redirect_uri: REDIRECT, state,
  code_challenge: challenge, code_challenge_method: "S256", resource: MCP, scope: "openid email",
})) authorize.searchParams.set(k, v);
writeFileSync(new URL("authorize-url.txt", import.meta.url), authorize.href + "\n");
console.log("인가 URL을 authorize-url.txt에 기록했다. 브라우저로 열어 승인하면 계속한다.");

const callback = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("인가 대기 시간 초과")), 10 * 60 * 1000);
  const srv = createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== "/callback") return res.end();
    res.end("실험 인가 완료. 이 창을 닫아도 된다.");
    clearTimeout(timer);
    srv.close();
    resolve(Object.fromEntries(u.searchParams));
  }).listen(55390, "127.0.0.1");
});
check("A1", "인가 응답의 state 일치", callback.state === state, `iss=${callback.iss ?? "(없음)"}`);

// 4. 토큰 교환
const tok = await (await fetch(as.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code", code: callback.code, redirect_uri: REDIRECT,
    client_id: reg.body.client_id, code_verifier: verifier, resource: MCP,
  }),
})).json();
const mcpClaims = claimsOf(tok.access_token);
check("T1", "MCP 토큰에 client_id", mcpClaims.client_id === reg.body.client_id, mcpClaims.client_id);
check("T2", "hook으로 MCP 토큰 aud가 MCP URL", mcpClaims.aud === MCP, JSON.stringify(mcpClaims.aud));

// 5. 일반 세션 토큰
const session = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: env.EXP_PUBLISHABLE_KEY },
  body: JSON.stringify({ email: env.EXP_USER_EMAIL, password: env.EXP_USER_PASSWORD }),
})).json();
const webClaims = claimsOf(session.access_token);
check("T3", "웹 세션 토큰 aud는 authenticated, client_id 없음", webClaims.aud === "authenticated" && !webClaims.client_id, JSON.stringify(webClaims.aud));

// 6. 교차 호출
const m1 = await mcpCall(tok.access_token);
check("X1", "MCP 토큰으로 MCP 도구 호출 성공", m1.status === 200 && m1.claims?.client_id === reg.body.client_id, JSON.stringify(m1));
const m2 = await mcpCall(session.access_token);
check("X2", "웹 세션 토큰으로 MCP 호출 거부", m2.status === 401, `${m2.status}`);
const a1 = await apiCall(session.access_token);
check("X3", "웹 세션 토큰으로 HTTP API 호출 성공", a1 === 200, `${a1}`);
const a2 = await apiCall(tok.access_token);
check("X4", "MCP 토큰으로 HTTP API 호출 거부", a2 === 401, `${a2}`);

// 7. 갱신 토큰
const refreshed = await (await fetch(as.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.body.client_id, resource: MCP }),
})).json();
const rc = refreshed.access_token ? claimsOf(refreshed.access_token) : {};
check("T4", "갱신한 MCP 토큰도 aud=MCP URL, client_id 유지", rc.aud === MCP && rc.client_id === reg.body.client_id, JSON.stringify({ aud: rc.aud, client_id: rc.client_id, error: refreshed.error }));

for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.desc}${r.detail ? ` (${r.detail})` : ""}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
