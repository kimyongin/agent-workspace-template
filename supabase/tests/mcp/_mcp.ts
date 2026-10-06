// MCP 계약 테스트 공통: 로컬 Supabase OAuth 2.1 서버에서 실제 흐름(동적 등록·PKCE·동의·코드 교환)으로
// MCP 토큰을 받고, 공식 MCP 클라이언트 SDK로 /functions/v1/mcp를 호출한다.
// 사람이 누르는 동의 화면 대신 같은 동의 API(supabase-js의 approveAuthorization이 쓰는 경로)를 사용자 세션으로 호출한다.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SUPABASE_URL } from "../http/_client.ts";

export const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;
const AUTH = `${SUPABASE_URL}/auth/v1`;
const REDIRECT = "http://127.0.0.1:55390/callback";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name}이 없습니다. npm run setup:local을 먼저 실행하세요`);
  return v;
}

export async function registerClient(redirect = REDIRECT): Promise<{ status: number; body: Record<string, string> }> {
  const res = await fetch(`${AUTH}/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "workspace-mcp-test",
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  return { status: res.status, body: await res.json() };
}

/** 사용자 세션으로 인가를 승인하고 MCP 토큰을 받는다. */
export async function mcpToken(sessionToken: string): Promise<string> {
  return (await mcpGrant(sessionToken)).access_token;
}

export async function mcpGrant(
  sessionToken: string,
): Promise<{ access_token: string; refresh_token: string; client_id: string }> {
  const client = (await registerClient()).body;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authorize = new URL(`${AUTH}/oauth/authorize`);
  for (
    const [k, v] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: MCP_URL,
      scope: "openid email",
    })
  ) authorize.searchParams.set(k, v);

  const step = await fetch(authorize, { redirect: "manual" });
  await step.body?.cancel();
  const consentUrl = new URL(step.headers.get("location") ?? "", SUPABASE_URL);
  const authorizationId = consentUrl.searchParams.get("authorization_id");
  if (!authorizationId) throw new Error(`동의 화면으로 가지 않았습니다: ${step.status} ${consentUrl}`);

  // 동의 화면이 하듯 인가 정보를 먼저 읽는다(클라이언트 이름·redirect 표시용, 사용자 세션과 연결).
  const headers = { apikey: env("VITE_SUPABASE_PUBLISHABLE_KEY"), authorization: `Bearer ${sessionToken}` };
  const details = await fetch(`${AUTH}/oauth/authorizations/${authorizationId}`, { headers });
  const detailBody = await details.json();
  if (!details.ok) throw new Error(`인가 정보 조회 실패: ${JSON.stringify(detailBody)}`);
  if (detailBody.redirect_url) return await exchange(detailBody.redirect_url, client.client_id, verifier, state);

  const consent = await fetch(`${AUTH}/oauth/authorizations/${authorizationId}/consent`, {
    method: "POST",
    headers: {
      apikey: env("VITE_SUPABASE_PUBLISHABLE_KEY"),
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "approve" }),
  });
  const approved = await consent.json();
  if (!consent.ok) throw new Error(`동의 실패: ${JSON.stringify(approved)}`);
  return await exchange(approved.redirect_url, client.client_id, verifier, state);
}

async function exchange(redirectUrl: string, clientId: string, verifier: string, state: string) {
  const callback = new URL(redirectUrl);
  if (callback.searchParams.get("state") !== state) throw new Error("state 불일치");
  const tokenRes = await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`토큰 교환 실패: ${JSON.stringify(token)}`);
  return {
    access_token: token.access_token as string,
    refresh_token: token.refresh_token as string,
    client_id: clientId,
  };
}

export function claimsOf(jwt: string): Record<string, unknown> {
  return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
}

export async function connectMcp(token: string): Promise<Client> {
  const client = new Client({ name: "workspace-mcp-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** 도구를 호출하고 구조화 결과를 돌려준다. 오류면 { error: {code,...} }. */
export async function tool(client: Client, name: string, args: Record<string, unknown>): Promise<Json> {
  if (
    ["create_entity", "create_task", "create_record", "create_principle", "create_tag", "record_occurrence"].includes(
      name,
    ) && !("id" in args)
  ) {
    args = { id: crypto.randomUUID(), ...args };
  }
  const res = await client.callTool({ name, arguments: args });
  const body = res.structuredContent ?? JSON.parse((res.content as { text: string }[])[0].text);
  return res.isError ? { error: body } : body;
}

export async function refreshMcp(grant: { refresh_token: string; client_id: string }): Promise<string> {
  const response = await fetch(AUTH + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: grant.refresh_token,
      client_id: grant.client_id,
      resource: MCP_URL,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error("OAuth refresh failed: " + response.status);
  return body.access_token;
}
