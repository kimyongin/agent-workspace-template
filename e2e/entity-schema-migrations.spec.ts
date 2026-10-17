import { expect } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
async function stopWorker(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000)
    ),
  ]);
}
test("값 변환 작업: 웹 접수→페이지 이탈→실제 local runner 완료→MCP 상태→직접 링크·새로고침", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  const types: string[] = [], entities: string[] = [];
  let runner: ChildProcess | undefined;
  try {
    const type = await mcp.call("create_entity_type", { label: unique("재료 작업"), icon_id: "leaf" }),
      other = await mcp.call("create_entity_type", { label: unique("상품 업무") });
    types.push(type.id, other.id);
    const x = await mcp.call("create_entity", {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "원본" },
      }),
      y = await mcp.call("create_entity", {
        entity_type_id: other.id,
        schema_version: 1,
        properties: { prop_1: "무관 상품" },
      });
    entities.push(x.id, y.id);
    const relation = await mcp.call("create_entity_relation_definition", {
      ends: [
        { type_id: type.id, label: "관련 상품", cardinality: "many" },
        { type_id: other.id, label: "관련 재료", cardinality: "many" },
      ],
    });
    await mcp.call("connect_entity_relation", {
      definition_id: relation.id,
      side: 0,
      origin_id: x.id,
      other_id: y.id,
      expected_definition_version: 1,
      expected_version: 1,
      expected_other_version: 1,
    });
    const otherBefore = await mcp.call("get_entity", { id: y.id });
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "count",
        field: { "x-order": 20, type: "integer", title: "수량" },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_2", value: 7 }], overrides: [] },
    });
    await mcp.call("analyze_entity_schema_change", {
      type_id: type.id,
      change_id: plan.id,
      expected_change_version: 1,
    });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: plan.id })).executable;
    }, { timeout: 30000 }).toBe(true);
    await page.goto(`/settings/entity-types/${type.id}/migrations?change_id=${plan.id}`);
    const response = page.waitForResponse((r) =>
      r.url().endsWith(`/schema-changes/${plan.id}/migrations`) && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "값 변환 시작", exact: true }).click();
    const accepted = await (await response).json();
    expect(accepted.status).toBe("queued");
    const path = `/settings/entity-types/${type.id}/migrations/${accepted.job_id}`;
    await expect(page).toHaveURL(new RegExp(`job_id=${accepted.job_id}(?:&|$)`));
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("접수");
    expect((await mcp.call("get_entity", { id: x.id })).properties).toEqual({ prop_1: "원본" });
    await page.getByRole("link", { name: "할 일", exact: true }).click();
    await page.goto(`/entities?entity_type_id=${other.id}`);
    // Explicit test infrastructure owns execution. No GET/page poll calls the worker.
    const origin = new URL(env.VITE_SUPABASE_URL);
    expect(["127.0.0.1", "localhost"]).toContain(origin.hostname);
    expect(origin.protocol).toBe("http:");
    runner = spawn(process.execPath, [
      new URL("../scripts/entity-schema-worker-local.mjs", import.meta.url).pathname,
      "--interval-ms=100",
      "--timeout-ms=10000",
      ...(process.env.ENTITY_SCHEMA_WORKER_CONFIG ? [`--config=${process.env.ENTITY_SCHEMA_WORKER_CONFIG}`] : []),
    ], { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdio: "ignore" });
    await expect.poll(async () => {
      expect(runner?.exitCode).toBeNull();
      return (await mcp.call("get_entity_schema_migration", { job_id: accepted.job_id })).status;
    }, { timeout: 30000 }).toBe("succeeded");
    await stopWorker(runner);
    runner = undefined;
    await page.goto(path);
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("완료");
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("완료");
    await expect(page.getByLabel("자료 종류 선택")).toHaveValue(type.id);
    const current = await mcp.call("get_entity", { id: x.id });
    expect(current.properties).toEqual({ prop_1: "원본", prop_2: 7 });
    expect(current.entity_type_id).toBe(type.id);
    expect(await mcp.call("get_entity", { id: y.id })).toEqual(otherBefore);
    expect(
      (await mcp.call("list_entity_relation_links", { definition_id: relation.id, side: 1, origin_id: y.id })).items
        .map((r: { id: string }) => r.id),
    ).toContain(x.id);
    const mcpJob = await mcp.call("get_entity_schema_migration", { job_id: accepted.job_id });
    expect(mcpJob.result.schema_version).toBe(2);
    await page.setViewportSize({ width: 320, height: 750 });
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await stopWorker(runner);
    await mcp.close();
    if (entities.length) await admin`delete from app.records where entity_ids&&${entities}::text[]`;
    if (entities.length) await admin`delete from app.entities where id=any(${entities}::text[])`;
    if (types.length) await admin`delete from app.entity_types where id=any(${types}::uuid[])`;
    await admin.end();
  }
});

test("값 변환 작업: MCP 접수→웹 취소→MCP 확정 상태·원본 유지", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  let typeId: string | undefined, entityId: string | undefined, restartedJobId: string | undefined;
  try {
    const type = await mcp.call("create_entity_type", { label: unique("취소 작업"), icon_id: "leaf" });
    typeId = type.id;
    const entity = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: "原本" },
    });
    entityId = entity.id;
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "value",
        field: { "x-order": 30, type: "boolean", title: "確認" },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_2", value: false }], overrides: [] },
    });
    await mcp.call("analyze_entity_schema_change", { type_id: typeId, change_id: plan.id, expected_change_version: 1 });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).executable;
    }).toBe(true);
    const ready = await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id }),
      job = await mcp.call("start_entity_schema_migration", {
        type_id: typeId,
        change_id: plan.id,
        expected_schema_version: 1,
        expected_change_version: 1,
        analysis_id: ready.analysis.id,
        fingerprint: ready.fingerprint,
      });
    await page.goto(`/settings/entity-types/${typeId}?job_id=${job.job_id}&change_id=${plan.id}`);
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("접수");
    await page.getByRole("button", { name: "변환 취소", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("취소");
    expect((await mcp.call("get_entity_schema_migration", { job_id: job.job_id })).status).toBe("cancelled");
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({ prop_1: "原本" });
    expect((await mcp.call("get_entity_schema", { type_id: typeId })).schema_version).toBe(1);
    const afterCancel = await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id });
    expect(afterCancel).toMatchObject({ status: "draft", analysis: null, executable: false });
    const history = page.getByRole("region", { name: "변경 이력", exact: true });
    await expect(history.getByRole("button", { name: "값 변환 시작", exact: true })).toHaveCount(0);
    await expect(history.getByText("검토 완료", { exact: true })).toHaveCount(0);
    const analysisResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/schema-changes/${plan.id}/analyze`)
    );
    await history.getByRole("button", { name: "변경 검토", exact: true }).click();
    const acceptedAnalysisResponse = await analysisResponse;
    expect(acceptedAnalysisResponse.status()).toBe(202);
    const nextAnalysis = await acceptedAnalysisResponse.json();
    expect(nextAnalysis.analysis_id).not.toBe(ready.analysis.id);
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).executable;
    }, { timeout: 30000 }).toBe(true);
    await expect(history.getByRole("button", { name: "값 변환 시작", exact: true })).toBeEnabled();
    const restartResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/schema-changes/${plan.id}/migrations`)
    );
    await history.getByRole("button", { name: "값 변환 시작", exact: true }).click();
    const restartedResponse = await restartResponse;
    expect(restartedResponse.status()).toBe(202);
    const restarted = await restartedResponse.json();
    restartedJobId = restarted.job_id;
    expect(restarted.job_id).not.toBe(job.job_id);
    expect(restarted.analysis_id).toBe(nextAnalysis.analysis_id);
    await expect(page).toHaveURL(new RegExp(`job_id=${restarted.job_id}(?:&|$)`));
    const cancelledAgain = await mcp.call("cancel_entity_schema_migration", {
      job_id: restarted.job_id,
      expected_job_version: restarted.job_version,
    });
    expect(cancelledAgain.status).toBe("cancelled");
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({ prop_1: "原本" });
    expect((await mcp.call("get_entity_schema", { type_id: typeId })).schema_version).toBe(1);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("취소");
  } finally {
    if (restartedJobId) {
      const remaining = await mcp.call("get_entity_schema_migration", { job_id: restartedJobId });
      if (["queued", "preparing", "ready_to_commit"].includes(remaining.status)) {
        await mcp.call("cancel_entity_schema_migration", {
          job_id: restartedJobId,
          expected_job_version: remaining.version,
        });
      }
    }
    await mcp.close();
    if (entityId) await admin`delete from app.records where entity_ids@>array[${entityId}]`;
    if (entityId) await admin`delete from app.entities where id=${entityId}`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});

test("값 변환 작업: 실제 worker 실패→웹 같은 작업 재시도→완료·MCP 성공 재현", async ({ page }) => {
  const workerUrl = new URL(env.LOCAL_DB_URL!);
  if (!["127.0.0.1", "localhost"].includes(workerUrl.hostname)) {
    throw new Error("worker failure fixture requires a loopback database");
  }
  const config = parse(readFileSync(
    process.env.ENTITY_SCHEMA_WORKER_CONFIG ?? new URL("../supabase/config.toml", import.meta.url),
    "utf8",
  ));
  const db = config.db as Record<string, unknown> | undefined;
  if (!db || !Number.isInteger(db.port) || workerUrl.port !== String(db.port)) {
    throw new Error("worker failure fixture database port must match the selected local config");
  }
  if (!env.APP_WORKER_PASSWORD) throw new Error("local worker credential missing");
  workerUrl.username = "app_worker";
  workerUrl.password = encodeURIComponent(env.APP_WORKER_PASSWORD);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} }),
    worker = postgres(workerUrl.href, { max: 1, prepare: false, onnotice: () => {} });
  let typeId: string | undefined, entityId: string | undefined;
  try {
    const type = await mcp.call("create_entity_type", { label: unique("재시도 작업"), icon_id: "leaf" });
    typeId = type.id;
    const entity = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: "보존 원본" },
    });
    entityId = entity.id;
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "count",
        field: { "x-order": 40, type: "integer", title: "수량" },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_2", value: 7 }], overrides: [] },
    });
    await mcp.call("analyze_entity_schema_change", { type_id: typeId, change_id: plan.id, expected_change_version: 1 });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).executable;
    }, { timeout: 30000 }).toBe(true);
    const ready = await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id });
    const job = await mcp.call("start_entity_schema_migration", {
      type_id: typeId,
      change_id: plan.id,
      expected_schema_version: 1,
      expected_change_version: 1,
      analysis_id: ready.analysis.id,
      fingerprint: ready.fingerprint,
    });
    // Explicit local fault injection uses the real fenced worker seam. A different claimed job rolls back.
    await worker.begin(async (tx) => {
      const [claimed] = await tx`select app.claim_entity_schema_migration() as batch`;
      expect(claimed.batch.id).toBe(job.job_id);
      const [failed] =
        await tx`select app.fail_entity_schema_migration(${job.job_id},${claimed.batch.fence},'migration_worker_failed',true) as accepted`;
      expect(failed.accepted).toBe(true);
    });
    const failed = await mcp.call("get_entity_schema_migration", { job_id: job.job_id });
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({ prop_1: "보존 원본" });
    expect((await mcp.call("get_entity_schema", { type_id: typeId })).schema_version).toBe(1);
    await page.goto(`/settings/entity-types/${typeId}/migrations/${job.job_id}`);
    await expect(page.getByRole("alert")).toContainText("같은 작업을 재시도할 수 있습니다");
    const response = page.waitForResponse((r) =>
      r.url().endsWith(`/entity-schema-migrations/${job.job_id}/retry`) && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "같은 작업 재시도", exact: true }).click();
    const resumedResponse = await response, resumed = await resumedResponse.json();
    expect(resumedResponse.status()).toBe(202);
    expect(resumed).toMatchObject({ job_id: job.job_id, job_version: failed.version + 1, status: "queued" });
    const retryKey = resumedResponse.request().headers()["idempotency-key"];
    expect(retryKey).toBeTruthy();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("접수");
    expect((await mcp.call("get_entity", { id: entityId })).version).toBe(entity.version);
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_migration", { job_id: job.job_id })).status;
    }, { timeout: 30000 }).toBe("succeeded");
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("완료");
    const current = await mcp.call("get_entity", { id: entityId });
    expect(current.properties).toEqual({ prop_1: "보존 원본", prop_2: 7 });
    expect(current.version).toBe(entity.version + 1);
    expect((await mcp.call("get_entity_schema", { type_id: typeId })).schema_version).toBe(2);
    expect(
      await mcp.call("retry_entity_schema_migration", {
        job_id: job.job_id,
        expected_job_version: failed.version,
        request_key: retryKey,
      }),
    ).toEqual(resumed);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("완료");
  } finally {
    await worker.end();
    await mcp.close();
    if (entityId) await admin`delete from app.records where entity_ids@>array[${entityId}]`;
    if (entityId) await admin`delete from app.entities where id=${entityId}`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});
