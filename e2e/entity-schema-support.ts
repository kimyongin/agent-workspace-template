import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { env } from "./support.ts";
/** Explicit actual internal worker consumption; callers own serial local API tests. */
export async function schemaAnalysisTick() {
  const token =
    parseEnv(readFileSync(new URL("../supabase/functions/.env", import.meta.url), "utf8")).ENTITY_SCHEMA_WORKER_TOKEN;
  if (!token) throw new Error("local schema worker token missing");
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/entity-schema-worker`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });
  expect(response.status).toBe(200);
  await response.json();
}
export async function analyzeAndApply(
  mcp: { call(name: string, input: Record<string, unknown>): Promise<any> },
  typeId: string,
  changeId: string,
  version: number,
) {
  const accepted = await mcp.call("analyze_entity_schema_change", {
    type_id: typeId,
    change_id: changeId,
    expected_change_version: version,
  });
  expect(accepted.status).toBe("queued");
  await expect.poll(async () => {
    await schemaAnalysisTick();
    return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: changeId })).status;
  }, { timeout: 30000 }).toBe("ready");
  return mcp.call("apply_entity_schema_change", {
    type_id: typeId,
    change_id: changeId,
    expected_change_version: version,
    analysis_id: accepted.analysis_id,
  });
}
