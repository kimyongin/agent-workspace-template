import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest(
  "MCP creates from issuer settings, restores retained values, and rekeys HTTP links",
  async () => {
    const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
    const external_id = `000Ab:/한글%${crypto.randomUUID()}`;
    let currentId: string | undefined;
    try {
      assertEquals((await client.listTools()).tools.some((t) => t.name === "prepare_entity_registration"), false);
      const settings = await tool(client, "get_business_settings", { id: "entity_identity" });
      const settings_version = settings.versions.entity_identity;
      assertEquals(Object.keys(settings.settings), ["entity_identity"]);
      const identity = { source: "app", external_id, settings_version };
      const created = await tool(client, "create_entity", {
        ...identity,
        prop1: "MCP 보관 대상",
        prop2: 0,
        prop4: "c",
      });
      currentId = created.id;
      assertEquals(created.id, `app:${external_id}`);
      assertEquals(
        (await call(token, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.external_id,
        external_id,
      );
      assertEquals(
        (await tool(client, "create_entity", { ...identity, prop1: "활성 중복" })).error.code,
        "conflict",
      );
      assertEquals(
        (await tool(client, "create_entity", {
          ...identity,
          external_id: `${external_id}-stale`,
          settings_version: settings_version + 1,
          prop1: "오래된 설정",
        })).error.code,
        "settings_changed",
      );
      await tool(client, "delete_entity", { id: created.id, expected_version: 1 });
      const restore = await tool(client, "get_entity", { id: created.id });
      assertEquals([restore.version, restore.prop2, restore.prop4], [2, 0, "c"]);
      assert(restore.deleted_at);
      for (const expected_version of [undefined, 1]) {
        assertEquals(
          (await tool(client, "create_entity", {
            ...identity,
            prop1: "오래된 등록",
            ...expected_version === undefined ? {} : { expected_version },
          })).error.code,
          "conflict",
        );
      }
      const restored = await tool(client, "create_entity", {
        ...identity,
        expected_version: restore.version,
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
  },
);
