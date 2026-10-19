// Actual LoginPage → Auth → workspace HTTP/DB tracer. No mocked transport or owner-based cleanup.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { parse } from "smol-toml";
import { openMainNavigation } from "./ui-actions.ts";
import { expect, type Page, test, type TestInfo } from "@playwright/test";

// Auth network traces would contain credentials/tokens. Evidence below records only owned IDs and keys.
test.use({ trace: "off" });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function required(values: Record<string, string | undefined>, name: string) {
  const value = values[name];
  if (!value) {
    throw new Error(
      `Explicit isolated workspace E2E setting required: ${name}`,
    );
  }
  return value;
}
function localUrl(value: string, credentials = false) {
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !credentials && (url.username || url.password)
  ) {
    throw new Error("Workspace E2E requires an explicit loopback target");
  }
  return url;
}
function isolatedEnvironment() {
  const envFile = resolve(required(process.env, "WORKSPACE_E2E_ENV_FILE"));
  const configFile = resolve(required(process.env, "WORKSPACE_E2E_CONFIG"));
  const ownershipFile = resolve(
    required(process.env, "WORKSPACE_E2E_OWNERSHIP"),
  );
  const runtimeRoot = resolve(dirname(configFile), "..");
  if (
    dirname(envFile) !== runtimeRoot || dirname(ownershipFile) !== runtimeRoot
  ) {
    throw new Error(
      "Workspace E2E configuration, environment and ownership must share one isolated runtime",
    );
  }
  const config = parse(readFileSync(configFile, "utf8")) as {
    project_id: string;
    api: { port: number };
    db: { port: number };
    auth: { site_url: string };
  };
  const ownership = JSON.parse(readFileSync(ownershipFile, "utf8")) as {
    project_id?: string;
  };
  const values = parseEnv(readFileSync(envFile, "utf8"));
  const auth = localUrl(required(values, "VITE_SUPABASE_URL"));
  const api = localUrl(required(values, "VITE_API_URL"));
  const db = localUrl(required(values, "LOCAL_DB_URL"), true);
  const web = localUrl(config.auth.site_url);
  const requestedWeb = localUrl(
    required(process.env, "WORKSPACE_E2E_BASE_URL"),
  );
  if (
    ownership.project_id !== config.project_id || !config.project_id ||
    auth.protocol !== "http:" || api.protocol !== "http:" ||
    web.protocol !== "http:" ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    Number(auth.port) !== config.api.port || api.origin !== auth.origin ||
    api.pathname !== "/functions/v1/api" ||
    Number(db.port) !== config.db.port || requestedWeb.origin !== web.origin
  ) {
    throw new Error(
      "Workspace E2E target does not match the explicit owned runtime configuration",
    );
  }
  return {
    values,
    api: api.href.replace(/\/$/, ""),
    auth: auth.origin,
    web: web.origin,
    projectId: config.project_id,
  };
}

function sessionId(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    const id = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
      .session_id;
    return typeof id === "string" && uuid.test(id) ? id : null;
  } catch {
    return null;
  }
}
async function openNavigation(page: Page) {
  await openMainNavigation(page);
  return page.getByRole("navigation", { name: "주 메뉴", exact: true });
}
/** A route click commits before the old mobile Sheet's closing Presence is removed. */
async function routeReady(page: Page, path: RegExp, heading: string) {
  await expect(page).toHaveURL(path);
  await expect(
    page.getByRole("heading", { name: heading, level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", {
      name: "주 메뉴",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
}
async function selectWorkspace(page: Page, name: string) {
  const sidebar = await openNavigation(page);
  await sidebar.getByRole("button", { name: "공간 선택", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

/** These manifests are recovery metadata, never a source for replaying writes. */
function ownedFixture(
  page: Page,
  info: TestInfo,
  environment: ReturnType<typeof isolatedEnvironment>,
  run: string,
) {
  const roots = new Map<string, string>(),
    invitations = new Set<string>(),
    keys = new Set<string>(),
    createKeys = new Set<string>(),
    sessions = new Set<string>();
  const pending = new Set<Promise<void>>(), captureErrors: string[] = [];
  let actor: string | null = null;
  const file = info.outputPath("owned-workspace-fixture.json");
  const persist = (cleaned = false) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(
      file,
      JSON.stringify(
        {
          project_id: environment.projectId,
          run,
          actor_id: actor,
          workspace_ids: [...roots.keys()],
          invitation_ids: [...invitations],
          request_keys: [...keys],
          session_ids: [...sessions],
          cleaned,
          capture_errors: captureErrors,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== new URL(environment.api).origin ||
      !url.pathname.startsWith(
        new URL(environment.api).pathname + "/workspaces",
      ) || !["POST", "PATCH", "DELETE"].includes(request.method())
    ) return;
    const key = request.headers()["idempotency-key"];
    if (key && uuid.test(key)) {
      keys.add(key);
      if (
        request.method() === "POST" &&
        url.pathname === new URL(environment.api).pathname + "/workspaces"
      ) createKeys.add(key);
      persist();
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url()), request = response.request();
    const login = url.origin === environment.auth &&
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "password";
    const control = url.origin === new URL(environment.api).origin &&
      url.pathname.startsWith(
        new URL(environment.api).pathname + "/workspaces",
      );
    if (request.method() !== "POST" || !response.ok() || !login && !control) {
      return;
    }
    const task = (async () => {
      const body = await response.json();
      if (login) {
        if (typeof body.user?.id !== "string" || !uuid.test(body.user.id)) {
          throw new Error("invalid real login identity");
        }
        actor = body.user.id;
        const id = sessionId(body.access_token);
        if (id) sessions.add(id);
      } else if (body.workspace) {
        if (
          !uuid.test(body.workspace.id) ||
          typeof body.workspace.name !== "string" ||
          !body.workspace.name.includes(run)
        ) throw new Error("unexpected workspace response");
        roots.set(body.workspace.id, body.workspace.name);
      } else if (body.invitation) {
        if (
          !uuid.test(body.invitation.id) ||
          !roots.has(body.invitation.workspace_id)
        ) throw new Error("unexpected invitation response");
        invitations.add(body.invitation.id);
      }
      persist();
    })().catch(() => {
      captureErrors.push(
        "A response ownership descriptor could not be captured",
      );
      persist();
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  persist();
  return {
    roots,
    async cleanup() {
      await Promise.all([...pending]);
      persist();
      if (!actor) {
        if (keys.size) {
          throw new Error(
            "Missing actor for owned workspace cleanup; manifest retained",
          );
        }
        return;
      }
      const sql = postgres(required(environment.values, "LOCAL_DB_URL"), {
        max: 1,
        onnotice: () => {},
      });
      try {
        await sql.begin(async (tx) => {
          if (createKeys.size) {
            const recovered =
              await tx`select w.id,w.name from private.workspace_request_results r join app.workspaces w on w.id=r.result_workspace_id where r.executor_id=${actor}::uuid and r.workspace_id is null and r.request_key=any(${[
                ...createKeys,
              ]}::uuid[]) and r.operation='workspace.create' and w.created_by=${actor}::uuid`;
            for (const row of recovered) {
              if (typeof row.name !== "string" || !row.name.includes(run)) {
                throw new Error(
                  "Recovered workspace does not belong to this run",
                );
              }
              roots.set(row.id, row.name);
            }
          }
          const ids = [...roots.keys()];
          if (ids.length) {
            const current =
              await tx`select id,name,created_by from app.workspaces where id=any(${ids}::uuid[]) for update`;
            if (
              current.length !== ids.length ||
              current.some((row) => row.created_by !== actor || row.name !== roots.get(row.id))
            ) {
              throw new Error(
                "Workspace cleanup ownership changed; no deletion applied",
              );
            }
            const [foreign] =
              await tx`select exists(select 1 from private.workspace_members where workspace_id=any(${ids}::uuid[]) and user_id<>${actor}::uuid) or exists(select 1 from app.entity_types where workspace_id=any(${ids}::uuid[])) or exists(select 1 from private.workspace_invitations where workspace_id=any(${ids}::uuid[]) and (created_by is distinct from ${actor}::uuid or email<>${`browser-${run}@example.test`})) as found`;
            if (foreign.found) {
              throw new Error(
                "Workspace cleanup contains unowned nested data; no deletion applied",
              );
            }
            await tx`delete from app.workspaces where id=any(${ids}::uuid[]) and created_by=${actor}::uuid`;
            const [remaining] =
              await tx`select (select count(*) from app.workspaces where id=any(${ids}::uuid[]))+(select count(*) from private.workspace_members where workspace_id=any(${ids}::uuid[]))+(select count(*) from private.workspace_grants where workspace_id=any(${ids}::uuid[]))+(select count(*) from private.workspace_invitations where workspace_id=any(${ids}::uuid[]))+(select count(*) from private.workspace_invitation_deliveries where workspace_id=any(${ids}::uuid[])) as count`;
            if (Number(remaining.count) !== 0) {
              throw new Error("Owned workspace cleanup left dependent rows");
            }
          }
          if (keys.size) {
            await tx`delete from private.workspace_request_results where executor_id=${actor}::uuid and request_key=any(${[
              ...keys,
            ]}::uuid[])`;
          }
          if (keys.size) {
            const [receipts] =
              await tx`select count(*) as count from private.workspace_request_results where executor_id=${actor}::uuid and request_key=any(${[
                ...keys,
              ]}::uuid[])`;
            if (Number(receipts.count) !== 0) {
              throw new Error(
                "Owned workspace request receipts were not removed",
              );
            }
          }
          if (sessions.size) {
            await tx`delete from auth.sessions where user_id=${actor}::uuid and id=any(${[
              ...sessions,
            ]}::uuid[])`;
          }
          const [account] = await tx`select exists(select 1 from auth.users where id=${actor}::uuid) as preserved`;
          if (!account.preserved) {
            throw new Error("Baseline Auth account was not preserved");
          }
        });
        persist(true);
        await info.attach("owned-workspace-cleanup", {
          path: file,
          contentType: "application/json",
        });
        if (captureErrors.length) {
          throw new Error(
            "Response ownership capture had errors; inspect the safe manifest",
          );
        }
      } finally {
        await sql.end();
      }
    },
  };
}

test(
  "real login creates and switches spaces, persists an invitation and manages deleted-space lifecycle",
  async ({ page, baseURL }, info) => {
    if (info.config.workers !== 1) {
      throw new Error("Workspace membership browser tests require one worker");
    }
    const environment = isolatedEnvironment();
    expect(new URL(baseURL!).origin).toBe(environment.web);
    const run = `${info.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
    const owned = ownedFixture(page, info, environment, run);
    try {
      await page.goto("/login");
      await page.getByLabel("이메일", { exact: false }).fill(
        required(environment.values, "DEV_USER_A_EMAIL"),
      );
      await page.getByLabel("비밀번호", { exact: false }).fill(
        required(environment.values, "DEV_USER_A_PASSWORD"),
      );
      await page.getByRole("button", { name: "이메일로 로그인", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: "내 공간", exact: true }))
        .toBeVisible();
      const names = [`실제 공간 A ${run}`, `실제 공간 B ${run}`];
      const created: string[] = [];
      for (const name of names) {
        await page.getByRole("button", { name: "새 공간 만들기", exact: true })
          .click();
        await page.getByRole("textbox", { name: "공간 이름", exact: true })
          .fill(name);
        const response = page.waitForResponse((response) =>
          response.url() === `${environment.api}/workspaces` &&
          response.request().method() === "POST"
        );
        await page.getByRole("button", { name: "공간 만들기", exact: true })
          .click();
        const confirmed = await response;
        expect(confirmed.status()).toBe(201);
        const body = await confirmed.json();
        expect(body.workspace.name).toBe(name);
        expect(body.workspace.id).toMatch(uuid);
        created.push(body.workspace.id);
        await routeReady(
          page,
          new RegExp(`/w/${body.workspace.id}/manage$`),
          "공간 관리",
        );
        const sidebar = await openNavigation(page);
        await expect(
          sidebar.getByRole("button", { name: "공간 선택", exact: true }),
        ).toContainText(name);
        await sidebar.getByRole("button", { name: "공간 선택", exact: true })
          .click();
        await page.getByRole("menuitem", {
          name: "공간 목록 · 새 공간",
          exact: true,
        }).click();
        await routeReady(page, /\/workspaces$/, "내 공간");
        await expect(
          page.getByRole("table", { name: "공간 목록", exact: true }).getByText(
            name,
            { exact: true },
          ),
        ).toBeVisible();
      }
      await selectWorkspace(page, names[0]);
      await routeReady(page, new RegExp(`/w/${created[0]}/manage$`), "공간 관리");
      const sidebar = await openNavigation(page);
      await sidebar.getByRole("button", { name: "공간 선택", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "이 공간 관리", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/w/${created[0]}/manage$`));
      await expect(
        page.getByRole("table", { name: "참여자", exact: true }).getByText(
          "설정 읽기·쓰기",
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "이메일로 초대", exact: true })
        .click();
      const email = `browser-${run}@example.test`;
      await page.getByRole("textbox", { name: "초대할 이메일", exact: true })
        .fill(email);
      await page.getByRole("radiogroup", { name: "할 일", exact: true })
        .getByRole("radio", { name: "읽기", exact: true }).click();
      const invitation = page.waitForResponse((response) =>
        response.url() ===
          `${environment.api}/workspaces/${created[0]}/invitations` &&
        response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "초대 만들기", exact: true })
        .click();
      expect((await invitation).status()).toBe(201);
      const invitationTable = page.getByRole("table", {
        name: "초대",
        exact: true,
      });
      await expect(invitationTable.getByText(email, { exact: true }))
        .toBeVisible();
      await expect(invitationTable.getByText("할 일 읽기", { exact: true }))
        .toBeVisible();
      await expect(invitationTable.getByText("수락 대기", { exact: true }))
        .toBeVisible();
      await expect(
        invitationTable.getByText("이메일 전달 대기", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("actual-workspace-management.png"),
        fullPage: true,
      });
      expect(owned.roots.size).toBe(2);
      const navigation = await openNavigation(page);
      await navigation.getByRole("button", { name: "공간 선택", exact: true }).click();
      await page.getByRole("menuitem", { name: "공간 목록 · 새 공간", exact: true }).click();
      await routeReady(page, /\/workspaces$/, "내 공간");
      const active = page.getByRole("table", { name: "공간 목록", exact: true });
      const deleted = page.getByRole("table", { name: "삭제한 공간", exact: true });
      for (const cycle of ["restore", "leave"] as const) {
        await active.getByRole("row").filter({ hasText: names[1] }).getByRole("button", { name: "삭제", exact: true })
          .click();
        await page.getByRole("alertdialog").getByRole("button", { name: "공간 삭제", exact: true }).click();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        const row = deleted.getByRole("row").filter({ hasText: names[1] });
        await expect(row).toBeVisible();
        if (cycle === "restore") {
          await page.screenshot({ path: info.outputPath("actual-deleted-workspace-selection.png"), fullPage: true });
          await row.getByRole("button", { name: "복원", exact: true }).click();
          await page.getByRole("alertdialog").getByRole("button", { name: "공간 복원", exact: true }).click();
          await expect(page.getByRole("alertdialog")).toHaveCount(0);
          await expect(active.getByText(names[1], { exact: true })).toBeVisible();
        } else {
          await row.getByRole("button", { name: "탈퇴", exact: true }).click();
          await page.getByRole("alertdialog").getByRole("button", { name: "공간 탈퇴", exact: true }).click();
          await expect(page.getByRole("alertdialog")).toHaveCount(0);
          await expect(deleted.getByText(names[1], { exact: true })).toHaveCount(0);
          await expect(active.getByText(names[1], { exact: true })).toHaveCount(0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await owned.cleanup();
    }
  },
);
