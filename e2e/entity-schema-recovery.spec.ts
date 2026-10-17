import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";

test("원본 복구: 웹 키보드 생성·분석→MCP 실행→자료·연결·현재 이름 유지·320px·만료", async ({ page }) => {
  test.setTimeout(120_000);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  const types: string[] = [], entities: string[] = [], relations: string[] = [];
  try {
    const type = await mcp.call("create_entity_type", { label: unique("원본 복구"), icon_id: "leaf" }),
      peerType = await mcp.call("create_entity_type", { label: unique("연결 자료") });
    types.push(type.id, peerType.id);
    const entity = await mcp.call("create_entity", {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "001 원본" },
      }),
      peer = await mcp.call("create_entity", {
        entity_type_id: peerType.id,
        schema_version: 1,
        properties: { prop_1: "연결 유지" },
      });
    entities.push(entity.id, peer.id);
    const relation = await mcp.call("create_entity_relation_definition", {
      ends: [
        { type_id: type.id, label: "복구 상대", cardinality: "many" },
        { type_id: peerType.id, label: "복구 원점", cardinality: "many" },
      ],
    });
    relations.push(relation.id);
    await mcp.call("connect_entity_relation", {
      definition_id: relation.id,
      side: 0,
      origin_id: entity.id,
      expected_definition_version: 1,
      other_id: peer.id,
      expected_version: 1,
      expected_other_version: 1,
    });
    const peerBefore = await mcp.call("get_entity", { id: peer.id });
    const original = await mcp.call("create_entity_schema_change", {
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
      change_id: original.id,
      expected_change_version: original.version,
    });
    await expect.poll(async () => {
      // Explicit local test infrastructure consumes work; page/status reads never trigger the worker.
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: original.id })).executable;
    }, { timeout: 30_000 }).toBe(true);
    const ready = await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: original.id });
    const started = await mcp.call("start_entity_schema_migration", {
      type_id: type.id,
      change_id: original.id,
      expected_change_version: ready.version,
      expected_schema_version: ready.source_schema_version,
      analysis_id: ready.analysis.id,
      fingerprint: ready.fingerprint,
    });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_migration", { job_id: started.job_id })).status;
    }, { timeout: 30_000 }).toBe("succeeded");
    expect((await mcp.call("get_entity", { id: entity.id })).properties).toEqual({ prop_1: "001 원본", prop_2: 7 });
    const currentType = await mcp.call("get_entity_type", { type_id: type.id }), label = unique("현재 복구 자료");
    await mcp.call("update_entity_type", {
      type_id: type.id,
      expected_schema_version: currentType.schema_version,
      label,
      icon_id: "star",
    });
    await page.goto(`/settings/entity-types/${peerType.id}/migrations/${started.job_id}`);
    await expect(page.getByRole("alert")).toContainText("이 자료 종류의 작업이 아닙니다");
    await expect(page.getByRole("button", { name: "원본 복구안 만들기", exact: true })).toHaveCount(0);
    await page.goto(`/settings/entity-types/${type.id}/migrations/${started.job_id}`);
    await expect(page.getByLabel("자료 종류 선택")).toHaveValue(type.id);
    await expect(page.getByLabel("자료 종류 선택").locator("option:checked")).toHaveText(label);
    expect((await mcp.call("get_entity_type", { type_id: type.id })).icon_id).toBe("star");
    const create = page.getByRole("button", { name: "원본 복구안 만들기", exact: true });
    await expect(create).toBeEnabled();
    const recoveryResponse = page.waitForResponse((r) =>
      r.url().endsWith(`/entity-schema-migrations/${started.job_id}/recovery-changes`) &&
      r.request().method() === "POST"
    );
    await create.focus();
    await expect(create).toBeFocused();
    await create.press("Enter");
    const response = await recoveryResponse;
    expect(response.status()).toBe(201);
    const recovery = await response.json();
    expect(recovery.status).toBe("draft");
    await expect(page).toHaveURL(new RegExp(`change_id=${recovery.id}(?:&|$)`));
    await expect(page.getByRole("link", { name: "원본 작업 확인", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "변경 초안 저장", exact: true })).toHaveCount(0);
    // Creating a recovery plan must not execute or restore values.
    expect((await mcp.call("get_entity", { id: entity.id })).properties.prop_2).toBe(7);
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: recovery.id })).executable;
    }, { timeout: 30_000 }).toBe(true);
    const row = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: `${entity.title} · ${entity.source} · ${entity.external_id} · 변경`,
        exact: true,
      }),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText("현재 값 7 → 복구 제거");
    const recoveryReady = await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: recovery.id });
    const expectedRecoverySchemaVersion = recoveryReady.source_schema_version + 1;
    const preview = await mcp.call("list_entity_schema_analysis_rows", {
      type_id: type.id,
      change_id: recovery.id,
      analysis_id: recoveryReady.analysis.id,
    });
    expect(preview.items[0].before).toEqual({ prop_1: "001 원본", prop_2: 7 });
    expect(preview.items[0].after).toEqual({ prop_1: "001 원본" });
    const accepted = await mcp.call("start_entity_schema_migration", {
      type_id: type.id,
      change_id: recovery.id,
      expected_change_version: recoveryReady.version,
      expected_schema_version: recoveryReady.source_schema_version,
      analysis_id: recoveryReady.analysis.id,
      fingerprint: recoveryReady.fingerprint,
    });
    await page.goto(`/settings/entity-types/${type.id}/migrations/${accepted.job_id}`);
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("접수");
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_migration", { job_id: accepted.job_id })).status;
    }, { timeout: 30_000 }).toBe("succeeded");
    await page.getByRole("button", { name: "상태 다시 조회", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toContainText("완료");
    await expect(page.getByText(new RegExp(`^새 입력 항목 버전 ${expectedRecoverySchemaVersion} · `))).toBeVisible();
    const restored = await mcp.call("get_entity", { id: entity.id });
    expect(restored.properties).toEqual({ prop_1: "001 원본" });
    expect(restored.entity_type_id).toBe(type.id);
    expect(restored.schema_version).toBe(expectedRecoverySchemaVersion);
    expect(await mcp.call("get_entity", { id: peer.id })).toEqual(peerBefore);
    expect(
      (await mcp.call("list_entity_relation_links", { definition_id: relation.id, side: 0, origin_id: entity.id }))
        .items.map((r: { id: string }) => r.id),
    ).toContain(
      peer.id,
    );
    expect(
      (await mcp.call("list_entity_relation_links", { definition_id: relation.id, side: 1, origin_id: peer.id })).items
        .map((r: { id: string }) => r.id),
    ).toContain(
      entity.id,
    );
    expect((await mcp.call("get_entity_type", { type_id: type.id })).label).toBe(label);
    expect((await mcp.call("get_entity_type", { type_id: type.id })).icon_id).toBe("star");
    await page.reload();
    await expect(page.getByLabel("자료 종류 선택")).toHaveValue(type.id);
    await expect(page.getByLabel("자료 종류 선택").locator("option:checked")).toHaveText(label);
    await page.setViewportSize({ width: 320, height: 750 });
    await expect(page.getByRole("status").filter({ hasText: /^(접수|실행 중|완료|취소) · / })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Expire only this test fixture after its successful GET; the actual write must report 410.
    await expect(create).toBeEnabled();
    await admin`update app.entity_schema_migrations set source_expires_at=now()-interval '1 second' where id=${accepted.job_id}`;
    const expiredResponse = page.waitForResponse((r) =>
      r.url().endsWith(`/entity-schema-migrations/${accepted.job_id}/recovery-changes`) &&
      r.request().method() === "POST"
    );
    await create.click();
    const expired = await expiredResponse;
    expect(expired.status()).toBe(410);
    expect((await expired.json()).code).toBe("migration_source_expired");
    await expect(page.getByRole("alert")).toContainText("입력한 내용은 유지됩니다");
    await page.getByRole("button", { name: "상태 다시 조회", exact: true }).click();
    await expect(page.getByText(/원본 보존 기간 만료/)).toBeVisible();
    await expect(create).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    try {
      await admin.begin(async (tx) => {
        if (entities.length) await tx`delete from app.records where entity_ids&&${entities}::text[]`;
        if (relations.length) await tx`delete from app.entity_relation_definitions where id=any(${relations}::uuid[])`;
        if (entities.length) await tx`delete from app.entities where id=any(${entities}::text[])`;
        if (types.length) await tx`delete from app.entity_types where id=any(${types}::uuid[])`;
      });
    } finally {
      try {
        await mcp.close();
      } finally {
        await admin.end();
      }
    }
  }
});
