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

import { chooseTag, detailDialog, executionDialog, openDetailEditor, saveOnce } from "./ui-actions.ts";
test(
  "actual shared entity: saved tag connections preserve content and obey current grants",
  async ({ page, browser, baseURL }, info) => {
    const env = isolatedEnvironment();
    expect(new URL(baseURL!).origin).toBe(env.web);
    const run = randomUUID(), name = `entity514-${run}`;
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
      entity_id: null as string | null,
      session_ids: sessionIds,
      request_keys: [] as string[],
      cleaned: false,
      last_path: "",
      api_statuses: [] as { path: string; method: string; status: number }[],
    };
    const persist = () => {
      const file = info.outputPath("owned-entity-fixture.json");
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
    for (const target of [page, bPage]) {
      target.setDefaultTimeout(15_000);
      target.setDefaultNavigationTimeout(15_000);
    }
    bPage.on("response", (response) => {
      if (response.url().startsWith(env.api + "/")) {
        manifest.api_statuses.push({
          path: new URL(response.url()).pathname,
          method: response.request().method(),
          status: response.status(),
        });
        persist();
      }
    });
    bPage.on("request", (request) => {
      if (request.url().startsWith(env.api + "/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        const key = request.headers()["idempotency-key"];
        if (key) {
          manifest.request_keys.push(key);
          persist();
        }
      }
    });
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
        timeout: 15_000,
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
      const label = `실제 자료 ${run.slice(0, 8)}`;
      const kindResponse = await request(a.token, "POST", "/entity-types", { label }, w);
      expect(kindResponse.status).toBe(201);
      const kind = kindResponse.body;
      manifest.type_id = kind.id;
      persist();
      const b = await login(bPage, "B");
      // Only membership is seeded: the browser actor gets no implicit kind/settings grant.
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${w},${b.id})`;
      expect(
        (await request(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, {
          expected_version: 1,
          grants: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
        })).status,
      ).toBe(200);
      const tagName = `연결 태그 ${run.slice(0, 8)}`;
      const tag = await request(b.token, "POST", "/tags", { scope: "entity", name: tagName }, w);
      expect(tag.status).toBe(201);
      manifest.tag_id = tag.body.id;
      persist();
      await bPage.goto(`${env.web}/w/${w}/entities?entity_type_id=${kind.id}`);
      await bPage.getByRole("button", { name: `${label} 추가`, exact: true }).click();
      const form = bPage.getByRole("dialog", { name: `${label} 추가`, exact: true });
      await expect(form).toBeVisible();
      await expect(form.getByRole("button", { name: "태그 선택", exact: true })).toHaveCount(0);
      const schema = await request(b.token, "GET", `/entity-types/${kind.id}/schema`, undefined, w);
      expect(schema.status).toBe(200);
      const titleLabel = schema.body.schema.properties.prop_1.title as string;
      const original = `실제 등록 ${run.slice(0, 8)}`;
      await form.getByLabel(titleLabel, { exact: false }).fill(original);
      const creation = bPage.waitForResponse((r) =>
        r.url() === `${env.api}/entities` && r.request().method() === "POST"
      );
      await saveOnce(bPage, form);
      const saved = await creation;
      expect(saved.status()).toBe(201);
      expect(saved.request().headers()["x-workspace-id"]).toBe(w);
      expect(saved.request().postDataJSON()).not.toHaveProperty("tag_ids");
      const entity = await saved.json();
      manifest.entity_id = entity.id;
      persist();
      const region = bPage.getByRole("region", { name: "태그 연결", exact: true });
      await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
      await expect(detailDialog(bPage).getByText("속성 정의를 불러오는 중…", { exact: true })).toHaveCount(0);
      await expect(detailDialog(bPage).getByText(original, { exact: true })).toBeVisible();
      await bPage.screenshot({ path: info.outputPath("actual-entity-created.png"), fullPage: true });
      await region.getByRole("button", { name: "태그 연결", exact: true }).click();
      await chooseTag(bPage, region, tagName);
      const connection = bPage.waitForResponse((r) =>
        r.url() === `${env.api}/tag-connections` && r.request().method() === "POST"
      );
      await region.getByRole("button", { name: "연결 적용", exact: true }).click();
      await executionDialog(bPage).getByRole("button", { name: "연결하고 저장", exact: true }).click();
      const connected = await connection;
      expect(connected.status()).toBe(200);
      expect(connected.request().postDataJSON()).toMatchObject({
        target_kind: "entity",
        target_id: entity.id,
        expected_version: 1,
        tag_ids: [tag.body.id],
      });
      await expect(region.getByText(tagName, { exact: true })).toBeVisible();
      await expect(detailDialog(bPage).getByText("기록 (2개)", { exact: true })).toBeVisible();
      await bPage.screenshot({ path: info.outputPath("actual-entity-tag-connected.png"), fullPage: true });
      await openDetailEditor(bPage);
      const edit = detailDialog(bPage);
      await expect(edit.getByRole("button", { name: "태그 선택", exact: true })).toHaveCount(0);
      await edit.getByLabel(titleLabel, { exact: false }).fill(`${original} 수정`);
      const update = bPage.waitForResponse((r) =>
        r.url() === `${env.api}/entities/${encodeURIComponent(entity.id)}` && r.request().method() === "PATCH"
      );
      await saveOnce(bPage, edit);
      const updated = await update;
      expect(updated.status()).toBe(200);
      expect(updated.request().postDataJSON()).not.toHaveProperty("tag_ids");
      expect((await updated.json()).tag_ids).toEqual([tag.body.id]);
      await bPage.goto(`${env.web}/w/${w}/entities/${encodeURIComponent(entity.id)}`);
      await expect(region.getByText(tagName, { exact: true })).toBeVisible();
      await region.getByRole("button", { name: "태그 연결", exact: true }).click();
      await region.getByRole("button", { name: "태그 선택", exact: true }).click();
      const savedChooser = bPage.getByRole("dialog", { name: "태그 선택", exact: true });
      await expect(savedChooser.getByRole("option", { name: tagName, exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      const grantAndRefresh = async (expected_version: number, access: "none" | "read" | "write") => {
        expect(
          (await request(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, {
            expected_version,
            grants: access === "none" ? [] : [{ target_kind: "entity_type", target_id: kind.id, access }],
          })).status,
        ).toBe(200);
        const refreshed = bPage.waitForResponse((response) =>
          response.url() === `${env.api}/workspaces/${w}` && response.request().method() === "GET"
        );
        await bPage.evaluate(() => window.dispatchEvent(new Event("focus")));
        expect((await refreshed).status()).toBe(200);
      };
      await grantAndRefresh(2, "none");
      await expect(savedChooser).not.toBeVisible();
      await expect(bPage.getByText(`${original} 수정`, { exact: true }).filter({ visible: true })).toHaveCount(0);
      await expect(bPage.getByText("불러오는 중…", { exact: true }).filter({ visible: true })).toHaveCount(0);
      await bPage.screenshot({ path: info.outputPath("actual-entity-none-tag-chooser.png"), fullPage: true });
      await grantAndRefresh(3, "read");
      await expect(savedChooser).toBeVisible();
      await expect(savedChooser.getByRole("option", { name: tagName, exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(savedChooser.getByRole("option", { name: tagName, exact: true })).toBeDisabled();
      await savedChooser.getByRole("button", { name: "닫기", exact: true }).click();
      await region.getByRole("button", { name: "연결 취소", exact: true }).click();
      await grantAndRefresh(4, "write");
      const unlink = bPage.waitForResponse((r) =>
        r.url() === `${env.api}/tag-connections` && r.request().method() === "POST"
      );
      await region.getByRole("button", { name: `${tagName} 연결 해제`, exact: true }).click();
      await region.getByRole("button", { name: "연결 적용", exact: true }).click();
      await executionDialog(bPage).getByRole("button", { name: "연결하고 저장", exact: true }).click();
      expect((await unlink).status()).toBe(200);
      await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
      await region.getByRole("button", { name: "태그 연결", exact: true }).click();
      expect(
        (await request(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, {
          expected_version: 5,
          grants: [{ target_kind: "entity_type", target_id: kind.id, access: "read" }],
        })).status,
      ).toBe(200);
      const refreshedAuthority = bPage.waitForResponse((response) =>
        response.url() === `${env.api}/workspaces/${w}` && response.request().method() === "GET"
      );
      await bPage.evaluate(() => window.dispatchEvent(new Event("focus")));
      expect((await refreshedAuthority).status()).toBe(200);
      await expect(region.getByRole("button", { name: "태그 선택", exact: true })).toBeDisabled();
      await expect(region.getByRole("button", { name: "연결 적용", exact: true })).toBeDisabled();
      await region.getByRole("button", { name: "연결 취소", exact: true }).click();
      await bPage.reload();
      await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
      await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toHaveCount(0);
      await expect(detailDialog(bPage).getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
      await expect(detailDialog(bPage).getByText("속성 정의를 불러오는 중…", { exact: true })).toHaveCount(0);
      await expect(detailDialog(bPage).getByText(`${original} 수정`, { exact: true })).toBeVisible();
      await expect(bPage.getByText("불러오는 중…", { exact: true }).filter({ visible: true })).toHaveCount(0);
      await bPage.screenshot({ path: info.outputPath("actual-entity-readonly.png"), fullPage: true });
      expect(
        (await request(a.token, "PATCH", `/workspaces/${w}/members/${b.id}`, { expected_version: 6, grants: [] }))
          .status,
      ).toBe(200);
      expect((await request(b.token, "GET", `/entities/${encodeURIComponent(entity.id)}`, undefined, w)).status).toBe(
        404,
      );
      await bPage.reload();
      await expect(bPage.getByText(`${original} 수정`, { exact: true })).toHaveCount(0);
    } catch (error) {
      errors.push(error);
      manifest.last_path = new URL(bPage.url()).pathname + new URL(bPage.url()).search;
      persist();
      try {
        await bPage.screenshot({ path: info.outputPath("actual-entity-failure.png"), fullPage: true, timeout: 5000 });
      } catch { /* Preserve the original failure. */ }
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
            const [root] = await tx`select name,created_by from app.workspaces where id=${w} for update`;
            expect(root).toEqual({ name, created_by: manifest.actor_ids[0] });
            const members = await tx`select user_id from private.workspace_members where workspace_id=${w}`;
            expect(members.every((m) => manifest.actor_ids.includes(m.user_id))).toBeTruthy();
            const kinds = await tx`select id from app.entity_types where workspace_id=${w}`;
            expect(kinds.map((k) => k.id)).toEqual(manifest.type_id ? [manifest.type_id] : []);
            const entities = await tx`select id from app.entities where workspace_id=${w}`;
            expect(entities.map((e) => e.id)).toEqual(manifest.entity_id ? [manifest.entity_id] : []);
            const tags = await tx`select id from app.tags where workspace_id=${w}`;
            expect(tags.map((t) => t.id)).toEqual(manifest.tag_id ? [manifest.tag_id] : []);
            expect(await tx`select id from app.data_model_changes where workspace_id=${w}`).toHaveLength(0);
            expect(await tx`select id from app.entity_schema_migrations where workspace_id=${w}`).toHaveLength(0);
            const records = await tx`select entity_id,task_id from app.records where workspace_id=${w}`;
            expect(records.every((r) => r.entity_id === manifest.entity_id && r.task_id === null)).toBeTruthy();
            await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${w}`;
            await tx`delete from app.workspaces where id=${w}`;
            expect(await tx`select id from app.workspaces where id=${w}`).toHaveLength(0);
          }
        });
        manifest.cleaned = true;
        persist();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (sessionIds.length) await admin`delete from auth.sessions where id=any(${sessionIds}::uuid[])`;
      } catch (error) {
        errors.push(error);
      }
      try {
        await admin.end();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "actual shared entity or exact owned cleanup failed");
  },
);
