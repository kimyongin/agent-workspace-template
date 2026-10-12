// E2E 보조: 로컬 설정 읽기, 개발용 로그인, 브라우저 동의 화면을 거친 MCP 토큰, MCP 클라이언트.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { expect, type Page, test as baseTest } from "@playwright/test";
import { parse } from "smol-toml";
import {
  cleanupOwnedFixture,
  type FixtureScope,
} from "../scripts/actual-fixture-cleanup.mjs";

export const env = parseEnv(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
);
const SUPABASE = env.VITE_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE)) {
  throw new Error("E2E는 로컬 Supabase에서만 실행합니다");
}
type Scope = {
  owners: Map<string, FixtureScope>;
  clients: Set<() => Promise<void>>;
  responses: Set<Promise<void>>;
  tokens: Set<string>;
};
let activeScope: Scope | null = null;
const tokenOwners = new Map<string, string>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tokenOwner(token: string) {
  try {
    const owner =
      JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
    return typeof owner === "string" && uuid.test(owner) ? owner : null;
  } catch {
    return null;
  }
}
function ownerScope(owner: string) {
  if (!activeScope || !uuid.test(owner)) return null;
  let scope = activeScope.owners.get(owner);
  if (!scope) {
    scope = {
      ownerId: owner,
      ids: { entities: [], tasks: [], records: [], tags: [], entity_types: [] },
      requestKeys: [],
    };
    activeScope.owners.set(owner, scope);
  }
  return scope;
}
export function ownFixtureResult(
  owner: string,
  root: keyof FixtureScope["ids"],
  id: string,
  requestKey?: string,
) {
  const scope = ownerScope(owner);
  if (!scope) return;
  if (typeof id === "string" && !scope.ids[root].includes(id)) {
    scope.ids[root].push(id);
  }
  if (
    requestKey && uuid.test(requestKey) &&
    !scope.requestKeys.includes(requestKey)
  ) scope.requestKeys.push(requestKey);
}
function ownFixtureRequest(owner: string, key: unknown) {
  const scope = ownerScope(owner);
  if (
    scope && typeof key === "string" && uuid.test(key) &&
    !scope.requestKeys.includes(key)
  ) scope.requestKeys.push(key);
}
/** Per-test ownership survives early MCP close and is released only after all UI work ends. */
export const test = baseTest.extend<{ _ownedFixture: void }>({
  _ownedFixture: [async ({ context }, use, testInfo) => {
    const scope: Scope = {
      owners: new Map(),
      clients: new Set(),
      responses: new Set(),
      tokens: new Set(),
    };
    activeScope = scope;
    const apiOrigin = new URL(env.VITE_API_URL).origin;
    context.on("request", (request) => {
      if (new URL(request.url()).origin !== apiOrigin) return;
      const owner = tokenOwner(
        request.headers().authorization?.replace(/^Bearer /i, "") ?? "",
      );
      if (owner) ownFixtureRequest(owner, request.headers()["idempotency-key"]);
    });
    context.on("response", (response) => {
      if (
        response.status() !== 201 || response.request().method() !== "POST" ||
        new URL(response.url()).origin !== apiOrigin
      ) return;
      const path = new URL(response.url()).pathname,
        root = path.endsWith("/api/entity-types")
          ? "entity_types"
          : (["entities", "tasks", "records", "tags"] as const).find((root) =>
            path.endsWith(`/api/${root}`)
          );
      const owner = tokenOwner(
        response.request().headers().authorization?.replace(/^Bearer /i, "") ??
          "",
      );
      if (!root || !owner) return;
      const read = (async () => {
        try {
          if (!await response.serverAddr()) return;
          const result = await response.json();
          ownFixtureResult(
            owner,
            root,
            result.id,
            response.request().headers()["idempotency-key"],
          );
        } catch {
          /* Completed writes can still be recovered from this test's exact request receipts. */
        }
      })();
      scope.responses.add(read);
      void read.finally(() => scope.responses.delete(read));
    });
    try {
      await use();
    } finally {
      await context.close();
      await Promise.allSettled([...scope.responses]);
      await Promise.allSettled([...scope.clients].map((close) => close()));
      try {
        if (
          [...scope.owners.values()].some((owner) =>
            Object.values(owner.ids).some((ids) => ids.length) ||
            owner.requestKeys.length
          )
        ) {
          if (testInfo.config.workers !== 1) {
            throw new Error(
              "actual fixture cleanup requires the serial local runner",
            );
          }
          const file = process.env.ENTITY_SCHEMA_WORKER_CONFIG ??
            new URL("../supabase/config.toml", import.meta.url);
          const config = parse(readFileSync(file, "utf8")) as {
            project_id: string;
            api: { port: number };
            db: { port: number };
          };
          const target = new URL(env.LOCAL_DB_URL);
          if (
            new URL(env.VITE_SUPABASE_URL).port !== String(config.api.port) ||
            Number(target.port) !== config.db.port
          ) {
            throw new Error(
              "actual fixture cleanup configuration does not match API/database",
            );
          }
          const environment = {
            name: config.project_id,
            host: target.hostname,
            port: config.db.port,
            database: decodeURIComponent(target.pathname.slice(1)),
          };
          const reports = [];
          for (const owner of scope.owners.values()) {
            reports.push(
              ...await cleanupOwnedFixture(
                env.LOCAL_DB_URL,
                environment,
                owner,
              ),
            );
          }
          await testInfo.attach("owned-fixture-cleanup", {
            body: JSON.stringify(reports),
            contentType: "application/json",
          });
        }
      } finally {
        for (const token of scope.tokens) tokenOwners.delete(token);
        activeScope = null;
      }
    }
  }, { auto: true }],
});
const AUTH = `${SUPABASE}/auth/v1`;
export const MCP_URL = `${SUPABASE}/functions/v1/mcp`;
const REDIRECT = "http://127.0.0.1:55390/callback";

export async function devLogin(page: Page, who: "A" | "B" = "A") {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(env[`DEV_USER_${who}_EMAIL`]);
  await page.getByLabel("비밀번호").fill(env[`DEV_USER_${who}_PASSWORD`]);
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await expect(page.getByRole("heading", { name: "할 일", level: 1 }))
    .toBeVisible();
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
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "ok",
    });
  });
  // A worktree can serve its app on a separate loopback port while the shared local Auth site_url stays fixed.
  // Preserve the real authorization request and ID, then show consent in the current app origin/session.
  const appOrigin = new URL(page.url()).origin;
  const authorization = await fetch(url, { redirect: "manual" });
  await authorization.body?.cancel();
  const consent = new URL(
    authorization.headers.get("location") ?? "",
    SUPABASE,
  );
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(appOrigin) ||
    consent.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(consent.hostname) ||
    consent.pathname !== "/oauth/consent"
  ) {
    throw new Error("Expected local OAuth consent redirect");
  }
  await page.goto(
    new URL(`${consent.pathname}${consent.search}`, appOrigin).href,
  );
  await expect(page.getByRole("heading", { name: "에이전트 연결 승인" }))
    .toBeVisible();
  await expect(page.getByText("E2E 에이전트")).toBeVisible();
  await expect(page.getByText(REDIRECT)).toBeVisible();
  await page.getByRole("button", { name: "승인" }).click();
  await expect.poll(() => callback?.searchParams.get("code") ?? null).not
    .toBeNull();
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
  const owner = tokenOwner(token.access_token);
  if (owner) {
    tokenOwners.set(token.access_token, owner);
    activeScope?.tokens.add(token.access_token);
  }
  return token.access_token;
}

export async function mcpClient(token: string) {
  const client = new Client({ name: "e2e-agent", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const owner = tokenOwners.get(token) ?? tokenOwner(token);
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await client.close();
    }
  };
  activeScope?.clients.add(close);
  return {
    async call(name: string, args: Record<string, unknown>) {
      const writing =
        /^(create_|update_|delete_|link_|unlink_|rename_|rekey_|complete_|stop_|resume_|analyze_|apply_|start_|cancel_|retry_|record_occurrence$)/
          .test(name);
      if (writing && !("request_key" in args)) {
        args = { ...args, request_key: crypto.randomUUID() };
      }
      if (writing && activeScope && !owner) {
        throw new Error("authenticated MCP fixture owner missing");
      }
      if (writing && owner) ownFixtureRequest(owner, args.request_key);
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) {
        throw new Error(
          `${name} 실패: ${JSON.stringify(res.structuredContent)}`,
        );
      }
      const result = res.structuredContent as Record<string, any>;
      const root = ({
        create_entity_type: "entity_types",
        create_entity: "entities",
        create_task: "tasks",
        create_record: "records",
        create_tag: "tags",
      } as const)[
        name as
          | "create_entity_type"
          | "create_entity"
          | "create_task"
          | "create_record"
          | "create_tag"
      ];
      if (root && owner) {
        ownFixtureResult(owner, root, result.id, String(args.request_key));
      }
      return result;
    },
    close,
  };
}

export const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
