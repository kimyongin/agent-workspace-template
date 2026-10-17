import { expect } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
import type { DataModelDocument } from "../supabase/functions/_shared/contracts/data-model.ts";

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

test("전체 모델 두 종류 변환: 웹 규칙·접수→페이지 이탈→독립 runner→재방문·새로고침", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  let runner: ChildProcess | undefined;
  try {
    const initial = JSON.parse(
      readFileSync(new URL("../docs/examples/data-model/cooking.json", import.meta.url), "utf8"),
    ) as DataModelDocument;
    initial.entity_types = initial.entity_types.slice(0, 2);
    initial.relations = [];
    for (const t of initial.entity_types) {
      t.schema.title = unique(t.schema.title);
      t.schema.properties.prop_2 = { type: "string", title: "수량", "x-order": 20 };
    }
    const input = { mode: "copy", document: JSON.stringify(initial) };
    const preview = await mcp.call("preview_data_model", input);
    const prepared = await mcp.call("prepare_data_model", { ...input, preview_fingerprint: preview.fingerprint });
    const installed = await mcp.call("apply_data_model", { id: prepared.id, expected_version: prepared.version });
    expect(installed.status).toBe("applied");
    const ids = Object.values(preview.mapping.types) as string[];
    const entities = [];
    for (const [index, id] of ids.entries()) {
      entities.push(
        await mcp.call("create_entity", {
          entity_type_id: id,
          schema_version: 1,
          properties: { prop_1: `변환 대상 ${index}`, prop_2: String(index + 8) },
        }),
      );
    }
    const target = await mcp.call("export_data_model", {}) as DataModelDocument;
    target.title = unique("전체 변환 검증");
    target.entity_types = target.entity_types.filter((t) => ids.includes(t.schema["x-type-id"]));
    target.relations = [];
    for (const t of target.entity_types) t.schema.properties.prop_2 = { type: "integer", title: "수량", "x-order": 20 };
    const update = { mode: "update", document: JSON.stringify(target) };
    const review = await mcp.call("preview_data_model", update);
    const change = await mcp.call("prepare_data_model", { ...update, preview_fingerprint: review.fingerprint });
    expect(change.status).toBe("needs_conversion");
    await page.goto("/settings/data-model");
    await page.getByRole("button", { name: new RegExp(target.title) }).click();
    const group = page.getByRole("region", { name: "기존 자료 값 변환" });
    await expect(group).toBeVisible();
    for (const t of target.entity_types) {
      const child = group.getByRole("region", { name: `${t.schema.title} 변환`, exact: true });
      if (!await child.getByLabel("수량 변환 방식").isVisible()) {
        await child.getByRole("button", { name: new RegExp(`${t.schema.title} 변환`) }).click();
      }
      await child.getByLabel("수량 변환 방식").selectOption("convert");
    }
    const analysisResponse = page.waitForResponse((r) =>
      r.url().endsWith(`/data-model/changes/${change.id}/analyze`) && r.request().method() === "POST"
    );
    await group.getByRole("button", { name: "변경 영향 확인", exact: true }).click();
    expect((await (await analysisResponse).json()).status).toBe("analyzing");
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_data_model_change", { id: change.id })).status;
    }, { timeout: 30000 }).toBe("ready");
    const applyResponse = page.waitForResponse((r) =>
      r.url().endsWith(`/data-model/changes/${change.id}/apply`) && r.request().method() === "POST"
    );
    await group.getByRole("button", { name: "검토한 설정 적용", exact: true }).click();
    const accepted = await (await applyResponse).json();
    expect(accepted.status).toBe("queued");
    expect((await mcp.call("get_data_model_change", { id: change.id })).group.children).toHaveLength(2);
    for (const entity of entities) expect((await mcp.call("get_entity", { id: entity.id })).schema_version).toBe(1);
    await page.getByRole("link", { name: "할 일", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks(?:[?#]|$)/);
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
      return (await mcp.call("get_data_model_change", { id: change.id })).status;
    }, { timeout: 30000 }).toBe("applied");
    await stopWorker(runner);
    runner = undefined;
    for (const [index, entity] of entities.entries()) {
      const current = await mcp.call("get_entity", { id: entity.id });
      expect(current.schema_version).toBe(2);
      expect(current.properties.prop_2).toBe(index + 8);
    }
    await page.goto("/settings/data-model");
    await expect(page.getByRole("button", { name: new RegExp(target.title) })).toContainText("전체 적용 완료");
    await page.getByRole("button", { name: new RegExp(target.title) }).click();
    await expect(page.getByRole("region", { name: target.title, exact: true }).getByText("적용 완료", { exact: true }))
      .toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(target.title) })).toContainText("전체 적용 완료");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await stopWorker(runner);
    await mcp.close();
  }
});
