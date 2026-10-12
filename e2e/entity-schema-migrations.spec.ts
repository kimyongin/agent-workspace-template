import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
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
    await mcp.call("link_entities", { id: x.id, other_id: y.id, expected_version: 1, expected_other_version: 1 });
    const otherBefore = await mcp.call("get_entity", { id: y.id });
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_type_version: 1,
      expected_schema_version: 1,
      edits: [{ op: "add_property", client_ref: "count", field: { type: "integer", title: "수량" }, required: true }],
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
    await page.getByRole("button", { name: "값 변환 실행", exact: true }).click();
    const accepted = await (await response).json();
    expect(accepted.status).toBe("queued");
    const path = `/settings/entity-types/${type.id}/migrations/${accepted.job_id}`;
    await expect(page).toHaveURL(new RegExp(`${accepted.job_id}$`));
    await expect(page.getByRole("status")).toContainText("접수");
    expect((await mcp.call("get_entity", { id: x.id })).properties).toEqual({ prop_1: "원본" });
    await page.getByRole("link", { name: "자료 목록", exact: true }).click();
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
    await expect(page.getByRole("status")).toContainText("완료");
    await page.reload();
    await expect(page.getByRole("status")).toContainText("완료");
    await expect(page.getByRole("heading", { name: new RegExp(type.label) })).toBeVisible();
    const current = await mcp.call("get_entity", { id: x.id });
    expect(current.properties).toEqual({ prop_1: "원본", prop_2: 7 });
    expect(current.entity_type_id).toBe(type.id);
    expect(await mcp.call("get_entity", { id: y.id })).toEqual(otherBefore);
    expect((await mcp.call("list_entity_links", { id: y.id })).items.map((r: { id: string }) => r.id)).toContain(x.id);
    const mcpJob = await mcp.call("get_entity_schema_migration", { job_id: accepted.job_id });
    expect(mcpJob.result.schema_version).toBe(2);
    await page.setViewportSize({ width: 320, height: 750 });
    await expect(page.getByRole("status")).toBeVisible();
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
  let typeId: string | undefined, entityId: string | undefined;
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
      expected_type_version: 1,
      expected_schema_version: 1,
      edits: [{ op: "add_property", client_ref: "value", field: { type: "boolean", title: "確認" }, required: true }],
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
        expected_type_version: 1,
        expected_schema_version: 1,
        expected_change_version: 1,
        analysis_id: ready.analysis.id,
        fingerprint: ready.fingerprint,
      });
    await page.goto(`/settings/entity-types/${typeId}/migrations/${job.job_id}`);
    await expect(page.getByRole("status")).toContainText("접수");
    await page.getByRole("button", { name: "적용 전 취소", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("취소");
    expect((await mcp.call("get_entity_schema_migration", { job_id: job.job_id })).status).toBe("cancelled");
    expect((await mcp.call("get_entity", { id: entityId })).properties).toEqual({ prop_1: "原本" });
    expect((await mcp.call("get_entity_schema", { type_id: typeId })).schema_version).toBe(1);
    await page.reload();
    await expect(page.getByRole("status")).toContainText("취소");
  } finally {
    await mcp.close();
    if (entityId) await admin`delete from app.records where entity_ids@>array[${entityId}]`;
    if (entityId) await admin`delete from app.entities where id=${entityId}`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});
