// E2E 보조: 로컬 설정 읽기, 개발용 로그인, 브라우저 동의 화면을 거친 MCP 토큰, MCP 클라이언트.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { workspacePath } from "../src/lib/workspace-route.tsx";
import type { WorkspaceGrant } from "../supabase/functions/_shared/contracts/workspace.ts";
import type { WorkspaceRequirement } from "../supabase/functions/_shared/core/workspaces/application.ts";
export { workspacePath };
import { parseEnv } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  type BrowserContext,
  expect,
  type Page,
  test as baseTest,
} from "@playwright/test";
import { parse } from "smol-toml";
import { recoverWorkspaceCreation, runWorkspaceCleanup } from "../scripts/workspace-fixture-cleanup.mjs";
import { modelFixtureRoots } from "../scripts/workspace-model-fixture.mjs";

export const env = parseEnv(
  readFileSync(
    process.env.WORKSPACE_E2E_ENV_FILE ??
      new URL("../.env.local", import.meta.url),
    "utf8",
  ),
);
export function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`E2E 환경 설정이 필요합니다: ${name}`);
  return value;
}
const SUPABASE = requiredEnv("VITE_SUPABASE_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE)) {
  throw new Error("E2E는 로컬 Supabase에서만 실행합니다");
}
type Scope = {
  clients: Set<() => Promise<void>>;
  contexts: Set<BrowserContext>;
  responses: Set<Promise<void>>;
  workspaces: OwnedWorkspace[];
  workspaceCreations: {
    name: string;
    actorId: string;
    projectId: string;
    creationKey: string;
    phase: "pending" | "unknown" | "created";
    workspaceId: string | null;
  }[];
  actors: Set<string>;
  sessionIds: Set<string>;
  oauthClientIds: Set<string>;
  runId: string;
  persist: () => void;
};
type OwnedWorkspace = {
  id: string;
  name: string;
  actorId: string;
  projectId: string;
  requestKeys: string[];
  createdKinds: string[];
  grants: WorkspaceGrant[];
  memberIds: string[];
  disposableEffectIds: string[];
  cleanup?: { manifest: unknown; approval: unknown; phase: "planned" | "applying" | "done"; result?: unknown };
  cleaned: boolean;
};
const pageSessions = new WeakMap<Page, { token: string; actorId: string }>();
/** Bind a second tab to the exact session already minted in this browser context. */
export async function shareFixtureSession(source: Page, target: Page) {
  const session = pageSessions.get(source);
  if (!activeScope || !session || source.context() !== target.context()) {
    throw new Error("fixture session sharing requires one tracked authenticated browser context");
  }
  ownedRuntime();
  pageSessions.set(target, session);
  await target.goto(source.url());
}
let activeScope: Scope | null = null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Persist only IDs from a just-minted Auth response, never its bearer token. */
function trackMintedSession(token: unknown) {
  if (!activeScope || typeof token !== "string") return;
  let claims: { session_id?: unknown; sub?: unknown } | null = null;
  try {
    claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
  } catch { /* Later response assertions report malformed Auth responses. */ }
  if (!claims) return;
  if (typeof claims.session_id === "string" && uuid.test(claims.session_id)) {
    activeScope.sessionIds.add(claims.session_id);
  }
  if (typeof claims.sub === "string" && uuid.test(claims.sub)) {
    activeScope.actors.add(claims.sub);
  }
  activeScope.persist();
}
function tokenOwner(token: string) {
  try {
    const owner =
      JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
    return typeof owner === "string" && uuid.test(owner) ? owner : null;
  } catch {
    return null;
  }
}
function ownWorkspaceKinds(workspaceId: string | undefined, root: string, result: Record<string, unknown>) {
  const workspace = activeScope?.workspaces.find((value) => value.id === workspaceId);
  if (!workspace) return;
  const ids = root === "entity_types" && typeof result.id === "string" ? [result.id]
    : root === "data_model_changes" ? modelFixtureRoots(result).entity_types : [];
  for (const id of ids) if (uuid.test(id) && !workspace.createdKinds.includes(id)) workspace.createdKinds.push(id);
  activeScope?.persist();
}
/** Per-test ownership survives early MCP close and is released only after all UI work ends. */
export const test = baseTest.extend<{ _ownedFixture: void }>({
  _ownedFixture: [async ({ context }, use, testInfo) => {
    const scope: Scope = {
      clients: new Set(),
      contexts: new Set([context]),
      responses: new Set(),
      workspaces: [],
      workspaceCreations: [],
      actors: new Set(),
      sessionIds: new Set(),
      oauthClientIds: new Set(),
      runId: crypto.randomUUID(),
      persist: () => {},
    };
    scope.persist = () =>
      writeFileSync(
        testInfo.outputPath("owned-workspaces.json"),
        JSON.stringify(
          {
            run: scope.runId,
            source_revision: process.env.WORKSPACE_E2E_SOURCE_REVISION ?? null,
            config_file: process.env.WORKSPACE_E2E_CONFIG ?? null,
            actor_ids: [...scope.actors],
            session_ids: [...scope.sessionIds],
            oauth_client_ids: [...scope.oauthClientIds],
            actual_proof: false,
            workspaces: scope.workspaces,
            workspace_creations: scope.workspaceCreations,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    activeScope = scope;
    const apiOrigin = new URL(requiredEnv("VITE_API_URL")).origin;
    context.on("request", (request) => {
      if (new URL(request.url()).origin !== apiOrigin) return;
      const workspace = scope.workspaces.find((value) =>
        value.id === request.headers()["x-workspace-id"]
      );
      if (workspace) {
        const key = request.headers()["idempotency-key"];
        if (key && !workspace.requestKeys.includes(key)) {
          workspace.requestKeys.push(key);
          scope.persist();
        }
        return;
      }

    });
    context.on("response", (response) => {
      if (
        response.status() !== 201 || response.request().method() !== "POST" ||
        new URL(response.url()).origin !== apiOrigin
      ) return;
      const path = new URL(response.url()).pathname,
        root = path.endsWith("/api/entity-issuers")
          ? "entity_issuers"
          : /\/api\/entity-issuers\/[^/]+\/rules$/.test(path)
          ? "entity_identifier_rules"
          : path.endsWith("/api/data-model/changes")
          ? "data_model_changes"
          : path.endsWith("/api/entity-relation-definitions")
          ? "entity_relation_definitions"
          : path.endsWith("/api/entity-types")
          ? "entity_types"
          : (["entities", "tasks", "records", "tags"] as const).find((root) =>
            path.endsWith(`/api/${root}`)
          );
      if (!root) return;
      const read = (async () => {
        try {
          if (!await response.serverAddr()) return;
          const result = await response.json();
          ownWorkspaceKinds(response.request().headers()["x-workspace-id"], root, result);

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
      const cleanupErrors: unknown[] = [];
      const contextsClosed = await Promise.allSettled(
        [...scope.contexts].map((value) => value.close()),
      );
      for (const result of contextsClosed) {
        if (result.status === "rejected") cleanupErrors.push(result.reason);
      }
      await Promise.allSettled([...scope.responses]);
      const closed = await Promise.allSettled(
        [...scope.clients].map((close) => close()),
      );
      for (const result of closed) {
        if (result.status === "rejected") cleanupErrors.push(result.reason);
      }
      try {
        if (scope.workspaces.length || scope.workspaceCreations.length) {
          if (testInfo.config.workers !== 1) {
            throw new Error("owned workspace fixtures require one worker");
          }
          const projectId = ownedRuntime();
          const admin = postgres(requiredEnv("LOCAL_DB_URL"), {
            max: 1,
            onnotice: () => {},
          });
          try {
            const target = new URL(requiredEnv("LOCAL_DB_URL"));
            for (const creation of scope.workspaceCreations.filter((intent) => intent.phase !== "created")) {
              try {
                if (creation.projectId !== projectId) throw new Error("owned workspace project changed");
                const recovered = await recoverWorkspaceCreation(admin, {
                  environment: { host: target.hostname, port: Number(target.port), database: decodeURIComponent(target.pathname.slice(1)) },
                  actor_id: creation.actorId,
                  request_key: creation.creationKey,
                  name: creation.name,
                });
                if (!recovered) throw new Error("owned workspace creation remains unresolved; inspect the persisted exact intent");
                creation.workspaceId = recovered.id;
                creation.phase = "created";
                scope.workspaces.push({
                  id: recovered.id, name: recovered.name, actorId: creation.actorId, projectId,
                  requestKeys: [creation.creationKey], createdKinds: [], grants: [],
                  memberIds: [creation.actorId], disposableEffectIds: [], cleaned: false,
                });
                scope.persist();
              } catch (error) {
                cleanupErrors.push(error);
              }
            }
            for (const workspace of scope.workspaces) {
              if (workspace.projectId !== projectId) {
                throw new Error("owned workspace project changed");
              }
              const manifest = {
                run_id: scope.runId,
                source_revision: process.env.WORKSPACE_E2E_SOURCE_REVISION,
                project_id: projectId,
                environment: { name: projectId, host: target.hostname, port: Number(target.port), database: decodeURIComponent(target.pathname.slice(1)) },
                workspace: { id: workspace.id, name: workspace.name, created_by: workspace.actorId },
                member_ids: workspace.memberIds,
                disposable_effect_ids: workspace.disposableEffectIds,
              };
              const approval = await runWorkspaceCleanup(admin, manifest);
              workspace.cleanup = { manifest, approval, phase: "planned" };
              scope.persist();
              expect(approval.blockers).toEqual([]);
              workspace.cleanup.phase = "applying";
              scope.persist();
              workspace.cleanup.result = await runWorkspaceCleanup(admin, manifest, approval);
              workspace.cleanup.phase = "done";
              workspace.cleaned = true;
              scope.persist();
            }
          } finally {
            await admin.end();
          }
          await testInfo.attach("owned-workspaces", {
            body: JSON.stringify(scope.workspaces),
            contentType: "application/json",
          });
        }

      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        // Auth cleanup also runs when creation, consent or owned-root cleanup failed early.
        if (scope.oauthClientIds.size || scope.sessionIds.size) {
          try {
            ownedRuntime();
            if (testInfo.config.workers !== 1) {
              throw new Error("owned Auth cleanup requires one worker");
            }
            for (const id of scope.oauthClientIds) {
              try {
                const secret = requiredEnv("LOCAL_SUPABASE_SECRET_KEY");
                const response = await fetch(
                  `${AUTH}/admin/oauth/clients/${encodeURIComponent(id)}`,
                  {
                    method: "DELETE",
                    headers: {
                      apikey: secret,
                      authorization: `Bearer ${secret}`,
                    },
                    signal: AbortSignal.timeout(15000),
                  },
                );
                await response.body?.cancel();
                expect(response.ok || response.status === 404).toBeTruthy();
              } catch (error) {
                cleanupErrors.push(error);
              }
            }
            if (scope.sessionIds.size) {
              const admin = postgres(requiredEnv("LOCAL_DB_URL"), {
                max: 1,
                onnotice: () => {},
              });
              try {
                await admin`delete from auth.sessions where id=any(${[
                  ...scope.sessionIds,
                ]}::uuid[])`;
              } finally {
                await admin.end();
              }
            }
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        scope.persist();
        activeScope = null;
      }
      if (cleanupErrors.length) {
        throw new AggregateError(
          cleanupErrors,
          "exact owned fixture cleanup failed; inspect the private ID manifest",
        );
      }
    }
  }, { auto: true }],
});
const AUTH = `${SUPABASE}/auth/v1`;
export const MCP_URL = `${SUPABASE}/functions/v1/mcp`;
const REDIRECT = "http://127.0.0.1:55390/callback";

export async function devLogin(page: Page, who: "A" | "B" = "A") {
  ownedRuntime();
  activeScope?.contexts.add(page.context());
  await page.goto("/login");
  await page.getByLabel("이메일").fill(requiredEnv(`DEV_USER_${who}_EMAIL`));
  await page.getByLabel("비밀번호").fill(
    requiredEnv(`DEV_USER_${who}_PASSWORD`),
  );
  const tokenResponse = page.waitForResponse((response) =>
    response.url().startsWith(`${AUTH}/token`) &&
    response.request().method() === "POST"
  ).then(async (response) => {
    const session = await response.json();
    trackMintedSession(session.access_token);
    return { response, session };
  });
  // Preserve tracking even if the click or a later UI assertion fails after minting.
  const read = tokenResponse.then(() => {}, () => {});
  activeScope?.responses.add(read);
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  const { response, session } = await tokenResponse;
  expect(response.ok()).toBeTruthy();
  if (
    !uuid.test(session.user?.id) || typeof session.access_token !== "string"
  ) throw new Error("authenticated fixture session missing");
  pageSessions.set(page, {
    token: session.access_token,
    actorId: session.user.id,
  });
  activeScope?.actors.add(session.user.id);
  if (activeScope?.workspaces.length) activeScope.persist();
  await expect(page.getByRole("heading", { name: "내 공간", exact: true }))
    .toBeVisible();
}

/** Same explicit isolated-runtime guard used by the actual workspace fixtures. */
export function ownedRuntime() {
  const setting = (name: string) => {
    const value = process.env[name];
    if (!value) {
      throw new Error(
        `Explicit owned workspace fixture setting required: ${name}`,
      );
    }
    return value;
  };
  const configFile = resolve(setting("WORKSPACE_E2E_CONFIG"));
  const root = resolve(dirname(configFile), "..");
  const envFile = resolve(setting("WORKSPACE_E2E_ENV_FILE"));
  const ownershipFile = resolve(setting("WORKSPACE_E2E_OWNERSHIP"));
  setting("WORKSPACE_E2E_SOURCE_REVISION");
  if (dirname(envFile) !== root || dirname(ownershipFile) !== root) {
    throw new Error("owned workspace runtime files disagree");
  }
  const config = parse(readFileSync(configFile, "utf8")) as {
    project_id: string;
    api: { port: number };
    db: { port: number };
    auth: { site_url: string };
  };
  const ownership = JSON.parse(readFileSync(ownershipFile, "utf8"));
  const auth = new URL(SUPABASE),
    api = new URL(requiredEnv("VITE_API_URL")),
    db = new URL(requiredEnv("LOCAL_DB_URL"));
  const web = new URL(setting("WORKSPACE_E2E_BASE_URL"));
  if (
    ![auth, api, db, web].every((url) =>
      ["127.0.0.1", "localhost"].includes(url.hostname)
    ) || [auth, api, web].some((url) => url.username || url.password) ||
    ownership.project_id !== config.project_id || !config.project_id ||
    auth.protocol !== "http:" || web.protocol !== "http:" ||
    api.origin !== auth.origin || api.pathname !== "/functions/v1/api" ||
    Number(auth.port) !== config.api.port ||
    Number(db.port) !== config.db.port ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    web.origin !== new URL(config.auth.site_url).origin
  ) {
    throw new Error(
      "owned workspace runtime does not match explicit project configuration",
    );
  }
  return config.project_id;
}

/** Creates one new root and explicitly grants only this fixture actor's required capabilities. */
export async function ownedWorkspace(page: Page) {
  const scope = activeScope, session = pageSessions.get(page);
  if (!scope || !session) {
    throw new Error("owned workspace requires the active authenticated test");
  }
  const projectId = ownedRuntime();
  if (
    new URL(page.url()).origin !==
      new URL(process.env.WORKSPACE_E2E_BASE_URL!).origin
  ) {
    throw new Error("authenticated browser does not match the owned runtime");
  }
  const requestKeys: string[] = [];
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    key: string = crypto.randomUUID(),
  ) => {
    requestKeys.push(key);
    scope.persist();
    const response = await page.request.fetch(
      `${requiredEnv("VITE_API_URL")}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${session.token}`,
          "Idempotency-Key": key,
        },
        data: body,
      },
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const name = unique("owned activity fixture");
  const creation: Scope["workspaceCreations"][number] = {
    name,
    actorId: session.actorId,
    projectId,
    creationKey: crypto.randomUUID(),
    phase: "pending",
    workspaceId: null,
  };
  scope.workspaceCreations.push(creation);
  scope.persist();
  let created: { workspace: { id: string } };
  try {
    created = await request(
      "POST",
      "/workspaces",
      { name },
      creation.creationKey,
    );
    if (!uuid.test(created.workspace?.id)) {
      throw new Error("workspace creation returned no identity");
    }
  } catch (error) {
    creation.phase = "unknown";
    scope.persist();
    throw error;
  }
  creation.workspaceId = created.workspace.id;
  creation.phase = "created";
  const fixture: OwnedWorkspace = {
    id: created.workspace.id,
    name,
    actorId: session.actorId,
    projectId,
    requestKeys,
    createdKinds: [],
    grants: [],
    memberIds: [session.actorId],
    disposableEffectIds: [],
    cleaned: false,
  };
  scope.workspaces.push(fixture);
  scope.persist();
  const grant = async (added: WorkspaceGrant[]) => {
    const current = await request("GET", `/workspaces/${fixture.id}`);
    const grants = [
      ...current.grants.filter((existing: WorkspaceGrant) =>
        !added.some((value) =>
          value.target_kind === existing.target_kind &&
          value.target_id === existing.target_id
        )
      ),
      ...added.filter((value) => value.access !== "none"),
    ];
    await request(
      "PATCH",
      `/workspaces/${fixture.id}/members/${session.actorId}`,
      { expected_version: current.membership_version, grants },
    );
    fixture.grants = grants;
    scope.persist();
  };
  await grant([{ target_kind: "tasks", target_id: "*", access: "write" }, {
    target_kind: "settings",
    target_id: "*",
    access: "write",
  }]);
  await page.goto(workspacePath(fixture.id, "/tasks"));
  await expect(page.getByRole("heading", { name: "할 일", level: 1 }))
    .toBeVisible();
  return {
    id: fixture.id,
    preservePreferences: async () => {
      ownedRuntime();
      const admin = postgres(requiredEnv("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });
      let original: unknown;
      try {
        const rows = await admin`select raw_user_meta_data from auth.users where id=${fixture.actorId}`;
        expect(rows).toHaveLength(1);
        original = rows[0].raw_user_meta_data;
      } finally { await admin.end(); }
      return async (expected: Record<string, unknown>) => {
        ownedRuntime();
        const restore = postgres(requiredEnv("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });
        try {
          await restore.begin(async (tx) => {
            const changed = await tx`update auth.users set raw_user_meta_data=${original === null ? null : JSON.stringify(original)}::jsonb
              where id=${fixture.actorId} and raw_user_meta_data=${JSON.stringify(expected)}::jsonb returning id`;
            if (!changed.length) {
              const unchanged = await tx`select id from auth.users where id=${fixture.actorId}
                and raw_user_meta_data is not distinct from ${original === null ? null : JSON.stringify(original)}::jsonb`;
              if (unchanged.length !== 1) throw new Error("fixture preferences changed outside the tracked test; preserved current metadata");
            }
          });
        } finally { await restore.end(); }
      };
    },
    fetch: (method: string, path: string, data?: unknown, key = crypto.randomUUID()) => {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error("fixture API path must be relative to its owned local service");
      fixture.requestKeys.push(key);
      scope.persist();
      return page.request.fetch(`${requiredEnv("VITE_API_URL")}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${session.token}`,
          "X-Workspace-Id": fixture.id,
          "Idempotency-Key": key,
        },
        data,
      });
    },
    registerMember: (id: string) => {
      if (!uuid.test(id)) throw new Error("explicit fixture member identity required");
      if (!fixture.memberIds.includes(id)) fixture.memberIds.push(id);
      scope.persist();
    },
    registerFakeEffects: (ids: string[]) => {
      if (ids.some((id) => !uuid.test(id))) throw new Error("explicit fake effect identities required");
      fixture.disposableEffectIds = [...new Set([...fixture.disposableEffectIds, ...ids])];
      scope.persist();
    },
    setTaskAccess: (access: "read" | "write" | "none") =>
      grant([{ target_kind: "tasks", target_id: "*", access }]),
    grantKind: async (typeId: string) => {
      // A browser response body may still be registering its exact new mapping.
      await Promise.all([...scope.responses]);
      if (!uuid.test(typeId) || !fixture.createdKinds.includes(typeId)) {
        throw new Error(
          "explicit publicly created fixture kind identity required",
        );
      }
      await grant([{
        target_kind: "entity_type",
        target_id: typeId,
        access: "write",
      }]);
    },
  };
}

/** Bulk list preparation only. Public CRUD and authorization assertions use the real API/MCP. */
export async function ownedFixtureSeed<T>(
  workspaceId: string,
  requirements: WorkspaceRequirement[],
  prepare: (tx: postgres.TransactionSql) => Promise<T>,
) {
  ownedRuntime();
  const fixture = activeScope?.workspaces.find((value) => value.id === workspaceId);
  if (!fixture) throw new Error("bulk seed requires this run's exact owned workspace");
  const admin = postgres(requiredEnv("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });
  try {
    return await admin.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: fixture.actorId, role: "authenticated" })},true)`;
      await tx`select app.lock_workspace(${fixture.id}::uuid,false)`;
      await tx`select app.authorize_workspace(${tx.json(requirements.map(({ target_kind, target_id, access }) => ({ target_kind, target_id, access })))})`;
      await tx`select set_config('request.workspace_requirements',${JSON.stringify(requirements)},true)`;
      return await prepare(tx);
    });
  } finally {
    await admin.end();
  }
}

const b64url = (b: Buffer) => b.toString("base64url");

/** 에이전트가 하듯 동적 등록·PKCE로 인가를 시작하고, 사용자가 웹 동의 화면에서 승인한 뒤 토큰을 받는다. */
export async function mcpTokenViaConsent(page: Page): Promise<string> {
  ownedRuntime();
  requiredEnv("LOCAL_SUPABASE_SECRET_KEY");
  if (!activeScope) {
    throw new Error("OAuth fixture requires an active tracked test");
  }
  const registration = await fetch(`${AUTH}/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "E2E 에이전트",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const reg = await registration.json();
  if (typeof reg.client_id === "string") {
    activeScope.oauthClientIds.add(reg.client_id);
    activeScope.persist();
  }
  expect(registration.status).toBe(201);
  expect(typeof reg.client_id).toBe("string");
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
  trackMintedSession(token.access_token);
  expect(token.access_token).toBeTruthy();
  return token.access_token;
}

export async function mcpClient(
  token: string,
  scope?: { workspaceId: string },
) {
  const workspaceId = scope?.workspaceId;
  if (scope && !uuid.test(workspaceId!)) {
    throw new Error("explicit MCP workspace identity required");
  }
  const client = new Client({ name: "e2e-agent", version: "0.0.0" });
  const owner = tokenOwner(token);
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await client.close();
    }
  };
  activeScope?.clients.add(close);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return Object.freeze({
    workspaceId,
    async call(name: string, args: Record<string, unknown>) {
      if (workspaceId) {
        if ("workspace_id" in args && args.workspace_id !== workspaceId) {
          throw new Error("MCP fixture workspace mismatch");
        }
        args = { ...args, workspace_id: workspaceId };
      }
      const writing =
        /^(create_|update_|delete_|restore_|link_|unlink_|rename_|rekey_|complete_|stop_|resume_|analyze_|apply_|start_|cancel_|retry_|record_occurrence$|set_tag_connections$)/
          .test(name) ||
        [
          "prepare_data_model",
          "connect_entity_relation",
          "replace_entity_relation",
        ].includes(name);
      if (writing && !("request_key" in args)) {
        args = { ...args, request_key: crypto.randomUUID() };
      }
      if (writing && activeScope && !owner) {
        throw new Error("authenticated MCP fixture owner missing");
      }
      const res = await client.callTool({ name, arguments: args });
      if (res.isError) {
        throw new Error(
          `${name} 실패: ${JSON.stringify(res.structuredContent)}`,
        );
      }
      const result = res.structuredContent as Record<string, any>;
      const root = ({
        create_entity_issuer: "entity_issuers",
        create_entity_identifier_rule: "entity_identifier_rules",
        create_entity_type: "entity_types",
        create_entity_relation_definition: "entity_relation_definitions",
        prepare_data_model: "data_model_changes",
        create_entity: "entities",
        create_task: "tasks",
        create_tag: "tags",
      } as const)[
        name as
          | "create_entity_issuer"
          | "create_entity_identifier_rule"
          | "create_entity_type"
          | "create_entity_relation_definition"
          | "prepare_data_model"
          | "create_entity"
          | "create_task"
          | "create_tag"
      ];
      if (root) ownWorkspaceKinds(workspaceId, root, result);
      if (scope && activeScope) {
        const workspace = activeScope.workspaces.find((value) =>
          value.id === scope.workspaceId
        );
        if (workspace && writing && typeof args.request_key === "string") {
          workspace.requestKeys.push(args.request_key);
          activeScope.persist();
        }
      }
      return result;
    },
    close,
  });
}

export const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
