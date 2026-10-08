import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("MCP prepares exact identity, restores retained values with version, and rekeys HTTP links", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  const external_id = `000Ab:/한글%${crypto.randomUUID()}`;
  let currentId: string | undefined;
  try {
    const prepared = await tool(client, "prepare_entity_registration", { source: "app", external_id });
    assertEquals([prepared.id, prepared.action, prepared.existing], [`app:${external_id}`, "create", null]);
    const created = await tool(client, "create_entity", {
      source: prepared.source,
      external_id: prepared.external_id,
      prop1: "MCP 보관 대상",
      prop2: 0,
      prop4: "c",
    });
    currentId = created.id;
    assertEquals(created.id, prepared.id);
    assertEquals(
      (await call(token, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.external_id,
      external_id,
    );
    const duplicate = await tool(client, "prepare_entity_registration", { source: "app", external_id });
    assertEquals(duplicate.action, "duplicate");
    await tool(client, "delete_entity", { id: created.id, expected_version: 1 });
    const restore = await tool(client, "prepare_entity_registration", { source: "app", external_id });
    assertEquals([restore.action, restore.expected_version, restore.existing.prop2, restore.existing.prop4], [
      "restore",
      2,
      0,
      "c",
    ]);
    assert(restore.existing.deleted_at);
    assertEquals(
      (await tool(client, "create_entity", { source: "app", external_id, prop1: "오래된 등록" })).error.code,
      "conflict",
    );
    const restored = await tool(client, "create_entity", {
      source: "app",
      external_id,
      expected_version: 2,
      prop3: "2026-10-09",
    });
    assertEquals([restored.prop1, restored.prop2, restored.prop4, restored.version, restored.deleted_at], [
      "MCP 보관 대상",
      0,
      "c",
      3,
      null,
    ]);
    const rekeyed = await tool(client, "rekey_entity", {
      id: restored.id,
      source: "app",
      external_id: `새:/ID%${external_id}`,
      expected_version: 3,
    });
    currentId = rekeyed.id;
    assertEquals(rekeyed.version, 4);
    assertEquals((await call(token, "GET", `/entities/${encodeURIComponent(created.id)}`)).status, 404);
    assertEquals((await call(token, "GET", `/entities/${encodeURIComponent(rekeyed.id)}`)).body.id, rekeyed.id);
    const events = await tool(client, "list_records", { entity_id: rekeyed.id, record_kind: "change", limit: 100 });
    assertEquals(events.items.length, 4);
    assertEquals(
      new Set(events.items.map((r: { change: { target_id: string } }) => r.change.target_id)),
      new Set([rekeyed.id]),
    );
  } finally {
    if (currentId) {
      const current = await tool(client, "get_entity", { id: currentId });
      if (!current.error && !current.deleted_at) {
        await tool(client, "delete_entity", { id: currentId, expected_version: current.version });
      }
    }
    await client.close();
  }
});
