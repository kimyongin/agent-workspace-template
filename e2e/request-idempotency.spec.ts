import {
  fixtureEntityList,
  scalarFixtureType,
} from "./entity-schema-support.ts";
import { mcpClient, mcpTokenViaConsent, test } from "./support.ts";
// Real browser + HTTP commit evidence. Only the response is lost; writes reach the local server.
import postgres from "postgres";
import { expect, type Page } from "@playwright/test";
import { devLogin, env, unique } from "./support.ts";
import { beginTabAction, fillChangeMemo, openDetailEditor, saveOnce } from "./ui-actions.ts";

async function evidence(page: Page) {
  const dbUrl = new URL(env.LOCAL_DB_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname)) throw new Error("Browser evidence requires a local DB");
  const db = postgres(dbUrl.href, { max: 1, onnotice: () => {} });
  const login = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY! },
    data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json(), owner = session.user.id as string;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${env.VITE_API_URL}${path}`, {
      method, headers: { authorization: `Bearer ${session.access_token}`, ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }) }, data,
    });
    expect(response.ok()).toBeTruthy();
    return response.status() === 204 ? null : response.json();
  };
  return {
    api,
    async taskCount(title: string) {
      const [row] = await db`select count(*)::int n from app.tasks where owner_id=${owner} and title=${title}`;
      return row.n;
    },
    async assertEvent(target: string, action: string) {
      const rows = await db`select id from app.records where owner_id=${owner} and record_kind='change'
        and change_metadata->>'target_id'=${target} and change_metadata->>'action'=${action}`;
      expect(rows).toHaveLength(1);
      const [queue] = await db`select count(*)::int n from pgmq.q_search_index
        where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=${rows[0].id}`;
      expect(queue.n).toBe(1);
    },
    async preparationState() {
      const [row] = await db`select
        (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${owner}) jobs,
        (select count(*)::int from private.request_results where owner_id=${owner}) receipts,
        (select count(*)::int from app.tasks where owner_id=${owner}) tasks,
        (select count(*)::int from app.entities where owner_id=${owner}) entities,
        (select count(*)::int from app.records where owner_id=${owner}) records`;
      return row;
    },
    close: () => db.end(),
  };
}

/** route.fetch commits against the real API before the first reply is aborted. */
async function loseCommittedReply(page: Page, method: string, path: string, status: number, loss: "abort" | "empty" | "malformed" = "abort") {
  const requests: { key: string; body: string | null; result: any; replay: string | undefined }[] = [];
  const url = `${env.VITE_API_URL}${path}`;
  const handler: Parameters<Page["route"]>[1] = async route => {
    if (route.request().method() !== method) return route.continue();
    const request = route.request();
    const reply = await route.fetch({ maxRetries: 0 });
    expect(reply.status()).toBe(status);
    const captured = {
      key: request.headers()["idempotency-key"], body: request.postData(),
      result: status === 204 ? null : await reply.json(), replay: reply.headers()["idempotency-replayed"],
    };
    expect(captured.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    requests.push(captured);
    if (requests.length === 1) {
      if (loss === "abort") await route.abort("failed");
      else {
        const headers = reply.headers();
        delete headers["content-length"];
        await route.fulfill({ status, headers, body: loss === "empty" ? "" : "{invalid-json" });
      }
    } else await route.fulfill({ response: reply });
  };
  await page.route(url, handler);
  return {
    requests,
    async retry() {
      const confirmation = page.locator("dialog.modal-action[open]");
      await expect(confirmation).toContainText("저장 여부를 알 수 없습니다.");
      // Only minimal metadata survives outside the in-memory attempt.
      const persisted = await page.evaluate(() => {
        const values: Record<string, string> = {};
        for (const storage of [sessionStorage, localStorage]) for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)!;
          values[key] = storage.getItem(key)!;
        }
        return values;
      });
      const unresolved = Object.entries(persisted).filter(([key]) => key.startsWith("workspace:unresolved-write:"));
      expect(unresolved).toHaveLength(1);
      const metadata = JSON.parse(unresolved[0][1]);
      expect(Object.keys(metadata).sort()).toEqual(["operation", "request_key", "status", "target"]);
      expect(metadata.request_key).toBe(requests[0].key);
      expect(metadata.status).toBe("unknown");
      const payload = JSON.parse(requests[0].body!);
      for (const value of Object.values(persisted)) {
        expect(value).not.toContain(requests[0].body!);
        for (const text of [payload.body, payload.change_note, payload.properties?.prop_1]) if (text) expect(value).not.toContain(text);
      }
      await confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
      await expect(confirmation).not.toBeVisible();
      expect(requests).toHaveLength(2);
      expect(requests[1].key).toBe(requests[0].key);
      expect(requests[1].body).toBe(requests[0].body);
      expect(requests[1].result).toEqual(requests[0].result);
      expect(requests[1].replay).toBe("true");
      // Dialog visibility and intercepted response fulfillment can precede the application's completion callback.
      // Observe the definite-outcome cleanup itself before considering the logical retry finished.
      await expect.poll(() => page.evaluate(key => sessionStorage.getItem(`workspace:unresolved-write:${key}`), requests[0].key)).toBeNull();
      await page.unroute(url, handler);
    },
  };
}

test("committed task create, edit and delete survive a lost reply with one event and queue each", async ({ page }) => {
  await devLogin(page);
  const proof = await evidence(page), title = unique("응답 유실 할 일"), body = unique("메모리에서만 보관할 본문");
  let id: string | undefined;
  try {
    await beginTabAction(page, "할 일 추가");
    const create = page.getByRole("dialog", { name: "할 일 추가", exact: true });
    await create.getByRole("textbox", { name: /^제목(?: \(필수\))?$/ }).fill(title);
    await create.getByLabel("본문").fill(body);
    await fillChangeMemo(page, create, unique("등록 메모"));
    const lostCreate = await loseCommittedReply(page, "POST", "/tasks", 201);
    await saveOnce(page, create, "추가");
    await lostCreate.retry();
    id = lostCreate.requests[0].result.id;
    expect(id).toMatch(/^\d{8}-[0-9A-Z]{8}$/);
    expect(JSON.parse(lostCreate.requests[0].body!)).not.toHaveProperty("id");
    await expect(page).toHaveURL(new RegExp(`/tasks/${id}(?:\\?|$)`));
    expect(await proof.taskCount(title)).toBe(1);
    await proof.assertEvent(id!, "create");

    await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: "할 일 편집", exact: true });
    await edit.getByLabel("본문").fill(`${body} 수정`);
    await fillChangeMemo(page, edit, unique("수정 메모"));
    const lostEdit = await loseCommittedReply(page, "PATCH", `/tasks/${id}`, 200);
    await saveOnce(page, edit);
    await lostEdit.retry();
    expect(lostEdit.requests[0].result.id).toBe(id);
    expect(lostEdit.requests[0].result.version).toBe(2);
    expect((await proof.api("GET", `/tasks/${id}`)).version).toBe(2);
    await proof.assertEvent(id!, "update");

    await openDetailEditor(page);
    await page.getByRole("dialog", { name: "할 일 편집", exact: true }).getByRole("button", { name: "삭제", exact: true }).click();
    const remove = page.locator("dialog.modal-action[open]");
    await remove.getByLabel("기록 메모", { exact: true }).fill(unique("삭제 메모"));
    const lostDelete = await loseCommittedReply(page, "POST", `/tasks/${id}/delete`, 204);
    await saveOnce(page, remove, "삭제 확인");
    await lostDelete.retry();
    expect(JSON.parse(lostDelete.requests[0].body!).expected_version).toBe(2);
    expect(await proof.taskCount(title)).toBe(0);
    await proof.assertEvent(id!, "delete");
    id = undefined;
  } finally {
    if (id && await proof.taskCount(title)) { const current = await proof.api("GET", `/tasks/${id}`); await proof.api("POST", `/tasks/${id}/delete`, { expected_version: current.version }); }
    await proof.close();
  }
});

test("external entity restore retries the committed tuple and type identity lookup allocates nothing", async ({ page }) => {
  await devLogin(page);
  const proof = await evidence(page), external_id = `000Ab:/한글%${unique("복원 식별자")}`, title = unique("응답 유실 복원");
  let id: string | undefined;
  try {
    const fixtureMcp = await mcpClient(await mcpTokenViaConsent(page));
    const type = await scalarFixtureType(fixtureMcp);
    await fixtureMcp.close();
    const source = `e2e_${
      crypto.randomUUID().replaceAll("-", "").slice(0, 16)
    }`;
    await proof.api("POST", "/entity-issuers", {
      code: source,
      label: "복원 검사 발급처",
    });
    const rule = await proof.api("POST", `/entity-issuers/${source}/rules`, {
      label: "원본 번호",
      meaning: "복원 검사용 원본 번호",
    });
    const initial = await proof.api("GET", `/entity-types/${type.id}/identity`);
    const identity = await proof.api(
      "PATCH",
      `/entity-types/${type.id}/identity`,
      {
        label: "식별자",
        default_source: source,
        expected_version: initial.version,
        sources: [
          ...initial.sources.map(({ code, rule_id, active }: any) => ({
            code,
            rule_id,
            active,
          })),
          { code: source, rule_id: rule.id, active: true },
        ],
      },
    );
    const entity = await proof.api("POST", "/entities", {
      source,
      external_id,
      identity_version: identity.version,
      entity_type_id:type.id,
      schema_version:type.schema_version,
      properties:{prop_1:title,prop_2:0,prop_4:"a"},
    });
    id = entity.id;
    await proof.api("POST", `/entities/${encodeURIComponent(id!)}/delete`, { expected_version: entity.version });
    const settings = await proof.api(
      "GET",
      `/entity-types/${type.id}/identity`,
    );
    const before = await proof.preparationState();
    const taskPreparation = await proof.api("POST", "/records/prepare", {
      model: "task", action: "create", input: { kind: "once", title: unique("준비만 하는 할 일") },
    });
    expect(taskPreparation.prepared_input).not.toHaveProperty("id");
    const identitySettings = await proof.api(
      "GET",
      `/entity-types/${type.id}/identity`,
    );
    expect(identitySettings).toEqual(settings);
    const retained = await proof.api("GET", `/entities/${encodeURIComponent(id!)}`);
    expect(retained.version).toBe(2);
    expect(retained.deleted_at).toBeTruthy();
    expect(await proof.preparationState()).toEqual(before);
    await page.goto(fixtureEntityList(type.id));
    await beginTabAction(page, "검사 자료 추가");
    const form = page.getByRole("dialog", { name: /^검사 자료.* 추가$/, exact: true });
    await expect(form.getByLabel("식별자")).toBeEnabled();
    await form.getByLabel("식별자").fill(external_id);
    await form.getByRole("button", { name: "기존 대상 확인", exact: true }).click();
    const restore = page.getByRole("dialog", { name: `${type.label} 복원`, exact: true });
    await expect(restore.getByLabel("제목")).toHaveValue(title);
    await fillChangeMemo(page, restore, unique("복원 메모"));
    expect(await proof.preparationState()).toEqual(before);
    const lostRestore = await loseCommittedReply(page, "POST", "/entities", 201);
    await saveOnce(page, restore);
    await lostRestore.retry();
    const payload = JSON.parse(lostRestore.requests[0].body!);
    expect([
      payload.source,
      payload.external_id,
      payload.identity_version,
      payload.expected_version,
    ]).toEqual([source, external_id, settings.version, 2]);
    expect(lostRestore.requests[0].result.id).toBe(id);
    const current = await proof.api("GET", `/entities/${encodeURIComponent(id!)}`);
    expect([current.version, current.deleted_at]).toEqual([3, null]);
    await proof.assertEvent(id!, "restore");
  } finally {
    if (id) { const current = await proof.api("GET", `/entities/${encodeURIComponent(id)}`); if (!current.deleted_at) await proof.api("POST", `/entities/${encodeURIComponent(id)}/delete`, { expected_version: current.version }); }
    await proof.close();
  }
});

for (const loss of ["empty", "malformed"] as const) {
  test(`committed create with a ${loss} success reply retains the original attempt`, async ({ page }) => {
    await devLogin(page);
    const proof = await evidence(page), title = unique(`${loss} 응답 할 일`);
    let id: string | undefined;
    try {
      await beginTabAction(page, "할 일 추가");
      const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
      await form.getByRole("textbox", { name: /^제목(?: \(필수\))?$/ }).fill(title);
      await form.getByLabel("본문").fill(unique("불완전 응답 본문"));
      const lost = await loseCommittedReply(page, "POST", "/tasks", 201, loss);
      await saveOnce(page, form, "추가");
      await lost.retry();
      id = lost.requests[0].result.id;
      expect(await proof.taskCount(title)).toBe(1);
      await proof.assertEvent(id!, "create");
    } finally {
      if (id) await proof.api("POST", `/tasks/${id}/delete`, { expected_version: 1 });
      await proof.close();
    }
  });
}
