// E2E 보조: 로컬 설정 읽기, 개발용 로그인, 브라우저 동의 화면을 거친 MCP 토큰, MCP 클라이언트.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, type Page } from "@playwright/test";

export const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const SUPABASE = env.VITE_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE)) throw new Error("E2E는 로컬 Supabase에서만 실행합니다");
const AUTH = `${SUPABASE}/auth/v1`;
export const MCP_URL = `${SUPABASE}/functions/v1/mcp`;
const REDIRECT = "http://127.0.0.1:55390/callback";

export async function devLogin(page: Page, who: "A" | "B" = "A") {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(env[`DEV_USER_${who}_EMAIL`]);
  await page.getByLabel("비밀번호").fill(env[`DEV_USER_${who}_PASSWORD`]);
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await expect(page.getByRole("heading", { name: "할 일", level: 1 })).toBeVisible();
}

const b64url = (b: Buffer) => b.toString("base64url");

/** 에이전트가 하듯 동적 등록·PKCE로 인가를 시작하고, 사용자가 웹 동의 화면에서 승인한 뒤 토큰을 받는다. */
export async function mcpTokenViaConsent(page: Page): Promise<string> {
  const reg = await (await fetch(`${AUTH}/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "E2E 에이전트",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })).json();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(16));
  const url = new URL(`${AUTH}/oauth/authorize`);
  for (
    const [k, v] of Object.entries({
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: REDIRECT,
      state,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource: MCP_URL,
    })
  ) url.searchParams.set(k, v);

  // 클라이언트의 loopback callback 서버 대신 그 요청을 가로채 code를 받는다.
  let callback: URL | null = null;
  await page.route(`${REDIRECT}**`, (route) => {
    callback = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
  });
  // A worktree can serve its app on a separate loopback port while the shared local Auth site_url stays fixed.
  // Preserve the real authorization request and ID, then show consent in the current app origin/session.
  const appOrigin = new URL(page.url()).origin;
  const authorization = await fetch(url, { redirect: "manual" });
  await authorization.body?.cancel();
  const consent = new URL(authorization.headers.get("location") ?? "", SUPABASE);
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(appOrigin) ||
    consent.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(consent.hostname) ||
    consent.pathname !== "/oauth/consent"
  ) {
    throw new Error("Expected local OAuth consent redirect");
  }
  await page.goto(new URL(`${consent.pathname}${consent.search}`, appOrigin).href);
  await expect(page.getByRole("heading", { name: "에이전트 연결 승인" })).toBeVisible();
  await expect(page.getByText("E2E 에이전트")).toBeVisible();
  await expect(page.getByText(REDIRECT)).toBeVisible();
  await page.getByRole("button", { name: "승인" }).click();
  await expect.poll(() => callback?.searchParams.get("code") ?? null).not.toBeNull();
  expect(callback!.searchParams.get("state")).toBe(state);

  const token = await (await fetch(`${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback!.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      client_id: reg.client_id,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  })).json();
  expect(token.access_token).toBeTruthy();
  return token.access_token;
}

export async function mcpClient(token: string) {
  const client = new Client({ name: "e2e-agent", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return {
    async call(name: string, args: Record<string, unknown>) {
      const writing =
        /^(create_|update_|delete_|link_|unlink_|rename_|rekey_|complete_|stop_|resume_|analyze_|apply_|start_|cancel_|retry_|record_occurrence$)/
          .test(name);
      if (writing && !("request_key" in args)) args = { ...args, request_key: crypto.randomUUID() };
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) throw new Error(`${name} 실패: ${JSON.stringify(res.structuredContent)}`);
      return res.structuredContent as Record<string, any>;
    },
    close: () => client.close(),
  };
}

export const unique = (label: string) => `${label} ${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
