import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { DataModelDocument } from "../supabase/functions/_shared/contracts/data-model.ts";
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
      await page.getByRole("button", { name: "기본 정보", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "자료 종류 이름", exact: true }),
      ).toHaveValue(label);
      await expect(page.getByText("자료 종류를 읽는 중…", { exact: true }))
        .toHaveCount(0);
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
      await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${w},true)`;
        await tx`insert into app.tags(workspace_id,owner_id,id,scope,name)
          values(${w},null,${tagId},'record',${tagName})`;
      });
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
      const savedTag = bPage.getByText(tagName, { exact: true });
      await expect(savedTag).toBeVisible();
      await expect(
        bPage.getByRole("textbox", { name: "메모 템플릿", exact: true }),
      ).toHaveAttribute("aria-readonly", "true");
      await expect(
        bPage.getByRole("button", { name: "기록 자동 완성 저장", exact: true }),
      ).toBeDisabled();
      await savedTag.scrollIntoViewIfNeeded();
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
            expect(tags.every((tag) => tag.id === manifest.tag_id))
              .toBeTruthy();
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

// Actual durable UI seam. Entity/membership preparation is explicitly seed-only;
// the model lifecycle is public HTTP plus genuine browser interaction.
test(
  "actual durable model UI: error repair, reconnect, retry, cancel and fresh publish",
  async ({ page, browser, baseURL }, info) => {
    const environment = isolatedEnvironment();
    expect(new URL(baseURL!).origin).toBe(environment.web);
    const run = randomUUID(), title = `실제 값 변환 ${run.slice(0, 8)}`;
    const manifest = {
      run,
      project_id: environment.projectId,
      source_revision: required(process.env, "WORKSPACE_E2E_SOURCE_REVISION"),
      workspace_id: null as string | null,
      workspace_name: `durable513-${run}`,
      actor_ids: [] as string[],
      session_ids: [] as string[],
      request_keys: [] as string[],
      type_ids: [] as string[],
      entity_ids: [] as string[],
      model_ids: [] as string[],
      analysis_ids: [] as string[],
      job_ids: [] as string[],
      cleaned: false,
    };
    const persist = () => {
      const file = info.outputPath("owned-durable-model-fixture.json");
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", {
        mode: 0o600,
      });
    };
    persist();
    const admin = postgres(required(environment.values, "LOCAL_DB_URL"), {
      max: 1,
      onnotice: () => {},
    });
    const workerStep = (packet: Record<string, unknown>) => {
      const file = info.outputPath("owned-worker-step.json");
      writeFileSync(file, JSON.stringify(packet), { mode: 0o600 });
      execFileSync(required(process.env, "WORKSPACE_E2E_DENO_BIN"), [
        "run",
        "--quiet",
        "--config",
        "supabase/functions/deno.json",
        "--allow-read",
        "--allow-env",
        "--allow-net=127.0.0.1,localhost",
        "e2e/workspace-model-worker.fixture.ts",
        file,
      ], {
        cwd: resolve("."),
        env: process.env,
        stdio: "pipe",
        timeout: 30_000,
      });
    };
    const errors: unknown[] = [];
    let actorPage: Page | undefined;
    let actorContext:
      | Awaited<ReturnType<typeof browser.newContext>>
      | undefined;
    const login = async (target: Page, who: "A" | "B") => {
      await target.goto(`${environment.web}/login`);
      await target.getByLabel("이메일", { exact: false }).fill(
        required(environment.values, `DEV_USER_${who}_EMAIL`),
      );
      await target.getByLabel("비밀번호", { exact: false }).fill(
        required(environment.values, `DEV_USER_${who}_PASSWORD`),
      );
      const response = target.waitForResponse((r) =>
        new URL(r.url()).origin === environment.auth &&
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
      manifest.actor_ids.push(session.user.id);
      manifest.session_ids.push(claims.session_id);
      persist();
      await expect(
        target.getByRole("heading", { name: "내 공간", exact: true }),
      ).toBeVisible();
      return {
        id: session.user.id as string,
        token: session.access_token as string,
      };
    };
    const api = async (
      token: string,
      method: string,
      path: string,
      body?: unknown,
      workspace?: string,
    ) => {
      const key = randomUUID();
      manifest.request_keys.push(key);
      persist();
      const response = await page.request.fetch(`${environment.api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "Idempotency-Key": key,
          ...(workspace ? { "X-Workspace-Id": workspace } : {}),
        },
        data: body,
      });
      expect(response.ok()).toBeTruthy();
      return await response.json();
    };
    const remember = (
      change: {
        id: string;
        group?: {
          children: {
            change: { analysis?: { id: string } };
            job?: { id: string };
          }[];
        };
      },
    ) => {
      if (!manifest.model_ids.includes(change.id)) {
        manifest.model_ids.push(change.id);
      }
      for (const child of change.group?.children ?? []) {
        if (
          child.change.analysis &&
          !manifest.analysis_ids.includes(child.change.analysis.id)
        ) manifest.analysis_ids.push(child.change.analysis.id);
        if (child.job && !manifest.job_ids.includes(child.job.id)) {
          manifest.job_ids.push(child.job.id);
        }
      }
      persist();
      return change;
    };
    try {
      const [pending] = await admin`select
      (select count(*) from app.entity_schema_analyses where status in ('queued','running')) +
      (select count(*) from app.entity_schema_migrations where status in ('queued','preparing','ready_to_commit','committing')) as n`;
      expect(Number(pending.n)).toBe(0);
      const a = await login(page, "A");
      actorContext = await browser.newContext({
        viewport: page.viewportSize(),
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
        deviceScaleFactor: info.project.use.deviceScaleFactor,
        userAgent: info.project.use.userAgent,
      });
      actorPage = await actorContext.newPage();
      const b = await login(actorPage, "B");
      const workspace = await api(a.token, "POST", "/workspaces", {
        name: manifest.workspace_name,
      });
      const w = workspace.workspace.id as string;
      manifest.workspace_id = w;
      persist();
      const kind = await api(a.token, "POST", "/entity-types", {
        label: `보완 자료 ${run.slice(0, 8)}`,
      }, w);
      manifest.type_ids.push(kind.id);
      persist();
      const grants = [{
        target_kind: "settings",
        target_id: "*",
        access: "write",
      }, { target_kind: "entity_type", target_id: kind.id, access: "write" }];
      await api(a.token, "PATCH", `/workspaces/${w}/members/${a.id}`, {
        expected_version: 1,
        grants,
      });
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${w},${b.id})`;
      await api(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, {
        expected_version: 1,
        grants,
      });
      const external = randomUUID(), entityId = `app:${kind.id}:${external}`;
      manifest.entity_ids.push(entityId);
      persist();
      workerStep({
        operation: "seed",
        workspace: w,
        actor: a.id,
        model: "",
        analysisIds: [],
        jobIds: [],
        kindId: kind.id,
        entityId,
        external,
      });
      const document = await api(
        b.token,
        "GET",
        "/data-model/export",
        undefined,
        w,
      ) as DataModelDocument;
      document.title = title;
      document.entity_types[0].schema.properties.prop_1.maxLength = 1;
      const prepare = async (target: DataModelDocument) => {
        const input = { mode: "update", document: JSON.stringify(target) };
        const preview = await api(
          b.token,
          "POST",
          "/data-model/preview",
          input,
          w,
        );
        const saved = await api(b.token, "POST", "/data-model/changes", {
          ...input,
          preview_fingerprint: preview.fingerprint,
        }, w);
        remember(saved);
        return saved;
      };
      const change = await prepare(document);
      const read = async (id = change.id) => {
        const value = await api(
          b.token,
          "GET",
          `/data-model/changes/${id}`,
          undefined,
          w,
        );
        remember(value);
        return value;
      };
      const internal = async (
        operation: "analysis" | "fail" | "publish",
        current: Awaited<ReturnType<typeof read>>,
      ) => {
        workerStep({
          operation,
          workspace: w,
          actor: b.id,
          model: current.id,
          analysisIds: current.group.children.map((
            c: { change: { analysis: { id: string } } },
          ) => c.change.analysis.id),
          jobIds: current.group.children.flatMap((
            c: { job?: { id: string } },
          ) => c.job ? [c.job.id] : []),
        });
      };
      const open = async (currentTitle: string, state: string) => {
        await actorPage!.goto(`${environment.web}/w/${w}/settings/data-model`);
        await actorPage!.getByRole("button", {
          name: `${currentTitle} ${state}`,
          exact: true,
        }).click();
        await expect(
          actorPage!.getByRole("region", {
            name: "기존 자료 값 변환",
            exact: true,
          }),
        ).toBeVisible();
      };
      const click = async (name: string, action: string) => {
        const response = actorPage!.waitForResponse((r) =>
          r.url() ===
            `${environment.api}/data-model/changes/${change.id}/${action}` &&
          r.request().method() === "POST"
        );
        await actorPage!.getByRole("button", { name, exact: true }).click();
        const result = await response;
        expect(result.ok()).toBeTruthy();
        expect(result.request().headers()["x-workspace-id"]).toBe(w);
        const key = result.request().headers()["idempotency-key"];
        if (key) manifest.request_keys.push(key);
        const value = await result.json();
        remember(value);
        return value;
      };
      await open(title, "값 변환 필요");
      await click("변경 영향 확인", "analyze");
      await expect(
        actorPage.getByText("요청한 작업을 진행하고 있습니다.", {
          exact: false,
        }),
      ).toBeVisible();
      await internal("analysis", await read());
      // The real polling response, rather than a forced UI refresh, reveals errors.
      await expect(
        actorPage.getByRole("button", {
          name: `${title} 값 변환 필요`,
          exact: true,
        }),
      ).toBeVisible();
      const childRegion = actorPage.getByRole("region", {
        name: `${kind.label} 변환`,
        exact: true,
      });
      if (!await childRegion.isVisible()) {
        await actorPage.getByRole("button", {
          name: `${kind.label} 변환 열기`,
          exact: true,
        }).click();
      }
      await expect(
        actorPage.getByRole("table", {
          name: "자료 값 변환 결과 목록",
          exact: true,
        }),
      ).toContainText("변환 실패");
      await actorPage.getByRole("button", { name: "보완값 지정", exact: true })
        .click();
      const correction = actorPage.getByRole("textbox", {
        name: "보완값",
        exact: true,
      });
      await correction.fill("X");
      await expect(correction).toHaveValue("X");
      await correction.scrollIntoViewIfNeeded();
      await actorPage.screenshot({
        path: info.outputPath("actual-durable-error-repair.png"),
        fullPage: true,
      });
      await click("변경 영향 확인", "analyze");
      await internal("analysis", await read());
      await expect(
        actorPage.getByRole("button", {
          name: "검토한 설정 적용",
          exact: true,
        }),
      ).toBeEnabled();
      await click("검토한 설정 적용", "apply");
      const queued = await read();
      expect(queued.status).toBe("queued");
      const reopenSettledDetail = async (
        state: "변환 준비 대기" | "취소됨",
        expectedJobId: string,
        expectedJobStatus: "queued" | "cancelled",
      ) => {
        await actorPage!.reload();
        const detailResponse = actorPage!.waitForResponse((response) =>
          response.url() ===
            `${environment.api}/data-model/changes/${change.id}` &&
          response.request().method() === "GET"
        );
        await actorPage!.getByRole("button", {
          name: `${title} ${state}`,
          exact: true,
        }).click();
        const response = await detailResponse;
        expect(response.ok()).toBeTruthy();
        expect(response.request().headers()["x-workspace-id"]).toBe(w);
        const detail = await response.json();
        remember(detail);
        expect(detail.group.children).toHaveLength(1);
        expect(detail.group.children[0].change.type_id).toBe(kind.id);
        expect(detail.group.children[0].job.id).toBe(expectedJobId);
        expect(detail.group.children[0].job.status).toBe(expectedJobStatus);
        await expect(
          actorPage!.getByText("변경안 상세를 읽는 중…", { exact: true }),
        ).toHaveCount(0);
        const group = actorPage!.getByRole("region", {
          name: "기존 자료 값 변환",
          exact: true,
        });
        await expect(group.getByText(`${kind.label} 변환`, { exact: true }))
          .toBeVisible();
        return detail;
      };
      await reopenSettledDetail(
        "변환 준비 대기",
        queued.group.children[0].job.id,
        "queued",
      );
      await expect(
        actorPage.getByText("요청한 작업을 진행하고 있습니다.", {
          exact: false,
        }),
      ).toBeVisible();
      await actorPage.getByRole("region", {
        name: "기존 자료 값 변환",
        exact: true,
      }).scrollIntoViewIfNeeded();
      await actorPage.screenshot({
        path: info.outputPath("actual-durable-reconnected.png"),
        fullPage: true,
      });
      await internal("fail", queued);
      await expect(
        actorPage.getByRole("button", {
          name: "값 변환 다시 시도",
          exact: true,
        }),
      ).toBeEnabled();
      await click("값 변환 다시 시도", "retry");
      const retried = await read();
      expect(retried.group.children[0].job.id).not.toBe(
        queued.group.children[0].job.id,
      );
      const cancelReceipt = await click("변경 취소", "cancel");
      // Mutation receipts intentionally carry counts and an empty child list.
      // The UI must hydrate full terminal details after accepting the receipt,
      // without requiring a reload or another history selection.
      expect(cancelReceipt.group.children).toHaveLength(0);
      const cancelledDetail = await read();
      expect(cancelledDetail.status).toBe("cancelled");
      expect(cancelledDetail.group.children).toHaveLength(1);
      expect(cancelledDetail.group.children[0].job.id).toBe(
        retried.group.children[0].job.id,
      );
      expect(cancelledDetail.group.children[0].job.status).toBe("cancelled");
      await expect(actorPage.getByText("변경안 상세를 읽는 중…", { exact: true }))
        .toHaveCount(0);
      const cancelledChild = actorPage.getByRole("row", {
        name: `${kind.label} 변환`,
        exact: true,
      });
      await expect(cancelledChild).toBeVisible();
      await expect(cancelledChild).toContainText("취소 · 처리 0/1개");
      await expect(
        actorPage.getByRole("button", { name: `${title} 취소됨`, exact: true }),
      ).toBeVisible();
      await cancelledChild.scrollIntoViewIfNeeded();
      await actorPage.screenshot({
        path: info.outputPath("actual-durable-retry-cancelled.png"),
        fullPage: true,
      });
      // A new public full-model attempt reuses the valid correction, never revives
      // the cancelled job. The final visible terminal state is an actual publish.
      const freshDocument = structuredClone(document);
      freshDocument.title = `${title} 새 적용`;
      const fresh = await prepare(freshDocument);
      await api(b.token, "POST", `/data-model/changes/${fresh.id}/analyze`, {
        expected_version: fresh.version,
        conversions: [{
          type_ref: freshDocument.entity_types[0].ref,
          migration: {
            rules: [],
            overrides: [{ entity_id: entityId, key: "prop_1", value: "X" }],
          },
        }],
      }, w);
      await internal("analysis", await read(fresh.id));
      await open(freshDocument.title, "적용 준비됨");
      const apply = actorPage.waitForResponse((r) =>
        r.url().endsWith(`/data-model/changes/${fresh.id}/apply`) &&
        r.request().method() === "POST"
      );
      await actorPage.getByRole("button", {
        name: "검토한 설정 적용",
        exact: true,
      }).click();
      expect((await apply).ok()).toBeTruthy();
      await internal("publish", await read(fresh.id));
      await expect(
        actorPage.getByRole("button", {
          name: `${freshDocument.title} 설정 적용 완료`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        actorPage.getByRole("region", {
          name: freshDocument.title,
          exact: true,
        }).getByText("적용 완료", { exact: true }),
      ).toBeVisible();
      await actorPage.getByRole("button", {
        name: `${freshDocument.title} 설정 적용 완료`,
        exact: true,
      }).scrollIntoViewIfNeeded();
      await actorPage.screenshot({
        path: info.outputPath("actual-durable-published.png"),
        fullPage: true,
      });
      const exported = await api(
        b.token,
        "GET",
        "/data-model/export",
        undefined,
        w,
      ) as DataModelDocument;
      expect(exported.entity_types[0].schema["x-version"]).toBe(2);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await actorContext?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await admin.begin(async (tx) => {
          const w = manifest.workspace_id;
          if (!w) return;
          const [root] =
            await tx`select name,created_by from app.workspaces where id=${w} for update`;
          expect(root).toEqual({
            name: manifest.workspace_name,
            created_by: manifest.actor_ids[0],
          });
          expect(
            (await tx`select user_id from private.workspace_members where workspace_id=${w}`)
              .every((row) => manifest.actor_ids.includes(row.user_id)),
          ).toBeTruthy();
          expect(
            (await tx`select id from app.entity_types where workspace_id=${w}`)
              .every((row) => manifest.type_ids.includes(row.id)),
          ).toBeTruthy();
          expect(
            (await tx`select id from app.entities where workspace_id=${w}`)
              .every((row) => manifest.entity_ids.includes(row.id)),
          ).toBeTruthy();
          expect(
            (await tx`select id from app.data_model_changes where workspace_id=${w}`)
              .every((row) => manifest.model_ids.includes(row.id)),
          ).toBeTruthy();
          await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${w}`;
          await tx`delete from pgmq.a_search_index where message->>'workspace_id'=${w}`;
          await tx`delete from app.workspaces where id=${w}`;
          expect(
            await tx`select id from app.entity_schema_migrations where workspace_id=${w}`,
          ).toHaveLength(0);
          expect(
            await tx`select msg_id from pgmq.q_search_index where message->>'workspace_id'=${w}`,
          ).toHaveLength(0);
          expect(
            await tx`select msg_id from pgmq.a_search_index where message->>'workspace_id'=${w}`,
          ).toHaveLength(0);
        });
        manifest.cleaned = true;
        persist();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (manifest.session_ids.length) {
          await admin`delete from auth.sessions where id=any(${manifest.session_ids}::uuid[])`;
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
        "actual durable model UI or exact owned cleanup failed",
        { cause: errors[0] },
      );
    }
  },
);
