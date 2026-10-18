import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { parse } from "smol-toml";
import { expect, type Page, test } from "@playwright/test";

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

// No mocked Auth/API. Membership and one tag are seed-only because invitation
// and general tag creation are outside this model/settings browser seam.
test(
  "actual model settings: UI kind creation and settings-only reader retains saved template tag metadata",
  async ({ page, browser, baseURL }, info) => {
    const env = isolatedEnvironment();
    expect(new URL(baseURL!).origin).toBe(env.web);
    const run = randomUUID(), name = `model513-${run}`;
    const admin = postgres(required(env.values, "LOCAL_DB_URL"), {
      max: 1,
      onnotice: () => {},
    });
    const sessionIds: string[] = [];
    const manifest = {
      run,
      project_id: env.projectId,
      web: env.web,
      api: env.api,
      source_revision: required(process.env, "WORKSPACE_E2E_SOURCE_REVISION"),
      actor_ids: [] as string[],
      workspace_id: null as string | null,
      workspace_name: name,
      type_id: null as string | null,
      tag_id: null as string | null,
      session_ids: sessionIds,
      request_keys: [] as string[],
      cleaned: false,
    };
    const persist = () => {
      const file = info.outputPath("owned-model-fixture.json");
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", {
        mode: 0o600,
      });
    };
    persist();
    const bContext = await browser.newContext({
      viewport: page.viewportSize(),
      isMobile: info.project.use.isMobile,
      hasTouch: info.project.use.hasTouch,
      deviceScaleFactor: info.project.use.deviceScaleFactor,
      userAgent: info.project.use.userAgent,
    });
    const bPage = await bContext.newPage();
    const errors: unknown[] = [];
    const login = async (target: Page, who: "A" | "B") => {
      await target.goto(`${env.web}/login`);
      await target.getByLabel("이메일", { exact: false }).fill(
        required(env.values, `DEV_USER_${who}_EMAIL`),
      );
      await target.getByLabel("비밀번호", { exact: false }).fill(
        required(env.values, `DEV_USER_${who}_PASSWORD`),
      );
      const response = target.waitForResponse((r) =>
        new URL(r.url()).origin === env.auth &&
        new URL(r.url()).pathname === "/auth/v1/token" &&
        r.request().method() === "POST"
      );
      await target.getByRole("button", { name: "이메일로 로그인", exact: true })
        .click();
      const result = await response;
      expect(result.ok()).toBeTruthy();
      const session = await result.json();
      const claims = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
      );
      sessionIds.push(claims.session_id);
      manifest.actor_ids.push(session.user.id);
      persist();
      await expect(
        target.getByRole("heading", { name: "내 공간", exact: true }),
      ).toBeVisible();
      return {
        token: session.access_token as string,
        id: session.user.id as string,
      };
    };
    const request = async (
      token: string,
      method: string,
      path: string,
      body?: unknown,
      workspace?: string,
    ) => {
      const key = randomUUID();
      manifest.request_keys.push(key);
      persist();
      const result = await page.request.fetch(`${env.api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "Idempotency-Key": key,
          ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        },
        data: body,
      });
      return { status: result.status(), body: await result.json() };
    };
    try {
      const a = await login(page, "A");
      const created = await request(a.token, "POST", "/workspaces", { name });
      expect(created.status).toBe(201);
      const w = created.body.workspace.id as string;
      manifest.workspace_id = w;
      persist();
      await page.goto(`${env.web}/w/${w}/settings/entity-types`);
      const label = `실제 자료 ${run.slice(0, 8)}`;
      await page.getByRole("textbox", { name: "자료 종류 이름", exact: true })
        .fill(label);
      const createdType = page.waitForResponse((r) =>
        r.url() === `${env.api}/entity-types` && r.request().method() === "POST"
      );
      await page.getByRole("button", { name: "자료 종류 만들기", exact: true })
        .click();
      const saved = await createdType;
      expect(saved.status()).toBe(201);
      expect(saved.request().headers()["x-workspace-id"]).toBe(w);
      const creationKey = saved.request().headers()["idempotency-key"];
      if (creationKey) manifest.request_keys.push(creationKey);
      const kind = await saved.json();
      manifest.type_id = kind.id;
      persist();
      await expect(page).toHaveURL(
        new RegExp(`/w/${w}/settings/entity-types/${kind.id}$`),
      );
      await page.screenshot({
        path: info.outputPath("actual-kind-created.png"),
        fullPage: true,
      });
      const b = await login(bPage, "B");
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${w},${b.id})`;
      expect(
        (await request(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, {
          expected_version: 1,
          grants: [{ target_kind: "settings", target_id: "*", access: "read" }],
        })).status,
      ).toBe(200);
      const tagId = randomUUID(), tagName = `저장 태그 ${run.slice(0, 8)}`;
      manifest.tag_id = tagId;
      persist();
      await admin`insert into app.tags(workspace_id,id,scope,name) values(${w},${tagId},'record',${tagName})`;
      const current = await request(
        a.token,
        "GET",
        "/settings/business?id=record_templates",
        undefined,
        w,
      );
      expect(current.status).toBe(200);
      expect(
        (await request(a.token, "PATCH", "/settings/business", {
          id: "record_templates",
          expected_version: current.body.versions.record_templates,
          value: {
            task: { create: { memo: "실제 저장 템플릿", tag_ids: [tagId] } },
          },
        }, w)).status,
      ).toBe(200);
      const metadata = await request(
        b.token,
        "GET",
        "/tags?scope=record&limit=100&purpose=record-template",
        undefined,
        w,
      );
      expect(metadata.status).toBe(200);
      expect(
        metadata.body.items.map((tag: { id: string; name: string }) => ({
          id: tag.id,
          name: tag.name,
        })),
      )
        .toEqual([{ id: tagId, name: tagName }]);
      await bPage.goto(`${env.web}/w/${w}/settings/entity-types/${kind.id}`);
      await expect(bPage.getByText("읽기 전용 설정", { exact: true }))
        .toBeVisible();
      await bPage.getByRole("button", { name: "기본 정보", exact: true })
        .click();
      await expect(
        bPage.getByRole("textbox", { name: "자료 종류 이름", exact: true }),
      ).toHaveValue(label);
      await expect(
        bPage.getByRole("textbox", { name: "자료 종류 이름", exact: true }),
      ).toBeDisabled();
      await expect(
        bPage.getByRole("button", { name: "기본 정보 저장", exact: true }),
      ).toBeDisabled();
      await expect(bPage.getByRole("link", { name: "종류 추가", exact: true }))
        .toHaveCount(0);
      await bPage.screenshot({
        path: info.outputPath("actual-settings-readonly.png"),
        fullPage: true,
      });
      const tags = bPage.waitForResponse((r) =>
        new URL(r.url()).pathname.endsWith("/tags") &&
        new URL(r.url()).searchParams.get("purpose") === "record-template"
      );
      await bPage.goto(`${env.web}/w/${w}/settings/records`);
      const readTags = await tags;
      expect(readTags.status()).toBe(200);
      expect(readTags.request().headers()["x-workspace-id"]).toBe(w);
      expect(
        (await readTags.json()).items.some((tag: { id: string }) =>
          tag.id === tagId
        ),
      ).toBeTruthy();
      await expect(bPage.getByText(tagName, { exact: true })).toBeVisible();
      await expect(
        bPage.getByRole("textbox", { name: "메모 템플릿", exact: true }),
      ).toHaveAttribute("aria-readonly", "true");
      await expect(
        bPage.getByRole("button", { name: "기록 자동 완성 저장", exact: true }),
      ).toBeDisabled();
      await bPage.screenshot({
        path: info.outputPath("actual-readonly-saved-template-tag.png"),
        fullPage: true,
      });
      expect(
        (await request(b.token, "PATCH", "/settings/business", {
          id: "record_templates",
          expected_version: 1,
          value: {},
        }, w)).status,
      ).toBe(403);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await bContext.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await admin.begin(async (tx) => {
          if (manifest.workspace_id) {
            const w = manifest.workspace_id;
            const [root] =
              await tx`select name,created_by from app.workspaces where id=${w} for update`;
            expect(root).toEqual({ name, created_by: manifest.actor_ids[0] });
            const members =
              await tx`select user_id from private.workspace_members where workspace_id=${w}`;
            expect(members.every((m) => manifest.actor_ids.includes(m.user_id)))
              .toBeTruthy();
            const kinds =
              await tx`select id from app.entity_types where workspace_id=${w}`;
            expect(kinds.map((k) => k.id)).toEqual(
              manifest.type_id ? [manifest.type_id] : [],
            );
            const entities =
              await tx`select id from app.entities where workspace_id=${w}`;
            expect(entities).toHaveLength(0);
            const tags =
              await tx`select id from app.tags where workspace_id=${w}`;
            expect(tags.map((t) => t.id)).toEqual(
              manifest.tag_id ? [manifest.tag_id] : [],
            );
            expect(
              await tx`select id from app.data_model_changes where workspace_id=${w}`,
            ).toHaveLength(0);
            expect(
              await tx`select id from app.entity_schema_migrations where workspace_id=${w}`,
            ).toHaveLength(0);
            await tx`delete from app.workspaces where id=${w}`;
            expect(await tx`select id from app.workspaces where id=${w}`)
              .toHaveLength(0);
          }
        });
        manifest.cleaned = true;
        persist();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (sessionIds.length) {
          await admin`delete from auth.sessions where id=any(${sessionIds}::uuid[])`;
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await admin.end();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        "actual model settings or exact owned cleanup failed",
      );
    }
  },
);
