import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
import { httpEntityFixture } from "../http/_entity.ts";

httpTest(
  "MCP creates from issuer settings, restores retained values, and rejects identity edits without changing HTTP links",
  async () => {
    const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
    const external_id = `000Ab:/한글%${crypto.randomUUID()}`;
    let currentId: string | undefined;
    try {
      const schema = await httpEntityFixture(token);
      assertEquals((await client.listTools()).tools.some((t) => t.name === "prepare_entity_registration"), false);
      const settings = await tool(client, "get_entity_type_identity", { type_id: schema.entity_type_id });
      assertEquals(settings.type_id, schema.entity_type_id);
      assertEquals(
        settings.sources.some((source: { code: string; generation: string }) =>
          source.code === "app" && source.generation === "automatic"
        ),
        true,
      );
      const identity_version = settings.version;
      const identity = { ...schema, source: "app", external_id, identity_version };
      const created = await tool(client, "create_entity", {
        ...identity,
        properties: { prop_1: "MCP 보관 대상", prop_2: 0, prop_4: "c" },
      });
      currentId = created.id;
      assertEquals(created.id, `app:${schema.entity_type_id}:${external_id}`);
      assertEquals(
        (await call(token, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.external_id,
        external_id,
      );
      assertEquals(
        (await tool(client, "create_entity", { ...identity, properties: { prop_1: "활성 중복" } })).error.code,
        "conflict",
      );
      assertEquals(
        (await tool(client, "create_entity", {
          ...identity,
          external_id: `${external_id}-stale`,
          identity_version: identity_version + 1,
          properties: { prop_1: "오래된 설정" },
        })).error.code,
        "settings_changed",
      );
      await tool(client, "delete_entity", { id: created.id, expected_version: 1 });
      const restore = await tool(client, "get_entity", { id: created.id });
      assertEquals([restore.version, restore.properties.prop_2, restore.properties.prop_4], [2, 0, "c"]);
      assert(restore.deleted_at);
      for (const expected_version of [undefined, 1]) {
        assertEquals(
          (await tool(client, "create_entity", {
            ...identity,
            properties: { prop_1: "오래된 등록" },
            ...expected_version === undefined ? {} : { expected_version },
          })).error.code,
          "conflict",
        );
      }
      const restored = await tool(client, "create_entity", {
        ...identity,
        expected_version: restore.version,
        properties: { prop_3: "2026-10-09" },
      });
      assertEquals([
        restored.properties.prop_1,
        restored.properties.prop_2,
        restored.properties.prop_4,
        restored.version,
        restored.deleted_at,
      ], [
        "MCP 보관 대상",
        0,
        "c",
        3,
        null,
      ]);
      for (const field of ["source", "external_id", "entity_type_id"]) {
        const rejected = await tool(client, "update_entity", {
          id: restored.id,
          expected_version: 3,
          schema_version: schema.schema_version,
          [field]: field === "entity_type_id" ? schema.entity_type_id : "replacement",
        });
        assertEquals(rejected.error.code, "entity_type_immutable");
      }
      assertEquals((await call(token, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.id, created.id);
      const events = await tool(client, "list_records", { entity_id: created.id, record_kind: "change", limit: 100 });
      assertEquals(events.items.length, 3);
      assertEquals(
        new Set(events.items.map((r: { change: { target_id: string } }) => r.change.target_id)),
        new Set([created.id]),
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
