import { assert, assertEquals } from "@std/assert";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "MCP field identity preserves raw values, explicitly restores tombstones and keeps HTTP links immutable",
  async ({ A: token, workspaceA: w, clientA: client, schema }) => {
    assert(client);
    const raw = `000Ab:/한글%${crypto.randomUUID()}`;
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const retired of ["prepare_entity_registration", "get_entity_type_identity", "update_entity_type_identity"]) {
      assertEquals(names.includes(retired), false);
    }
    assert(names.includes("lookup_entity_identifier") && names.includes("restore_entity"));
    const definition = await scopedTool(client, w, "get_entity_schema", { type_id: schema.entity_type_id });
    const key = definition.schema["x-identity-property"], kind = "00000000-0000-4000-8000-000000000001";
    assert(
      definition.identifier_kinds.some((value: { id: string; generation: string }) =>
        value.id === kind && value.generation === "automatic"
      ),
    );
    const pair = encodeIdentifierValue(kind, raw);
    const properties = { prop_1: "MCP 보관 대상", prop_2: 0, prop_4: "c", [key]: pair };
    const created = await scopedTool(client, w, "create_entity", { ...schema, properties });
    assertEquals(created.id, encodeIdentifierReference(schema.entity_type_id, kind, raw));
    assertEquals(
      (await scopedHttp(token, w, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.properties[key],
      pair,
    );
    assertEquals((await scopedTool(client, w, "create_entity", { ...schema, properties })).error.code, "conflict");
    assertEquals(
      (await scopedTool(client, w, "create_entity", {
        ...schema,
        schema_version: schema.schema_version + 1,
        properties: { ...properties, [key]: encodeIdentifierValue(kind, `${raw}-stale`) },
      })).error.code,
      "schema_changed",
    );
    await scopedTool(client, w, "delete_entity", { id: created.id, expected_version: 1 });
    const archived = await scopedTool(client, w, "lookup_entity_identifier", {
      entity_type_id: schema.entity_type_id,
      identifier: pair,
    });
    assertEquals([archived.id, archived.version, archived.properties.prop_2, archived.properties.prop_4], [
      created.id,
      2,
      0,
      "c",
    ]);
    assert(archived.deleted_at);
    assertEquals((await scopedTool(client, w, "create_entity", { ...schema, properties })).error.code, "conflict");
    assertEquals(
      (await scopedTool(client, w, "create_entity", { ...schema, properties, expected_version: 2 })).error.code,
      "invalid_input",
    );
    assertEquals(
      (await scopedTool(client, w, "restore_entity", {
        request_key: crypto.randomUUID(),
        id: archived.id,
        schema_version: schema.schema_version,
        expected_version: 1,
      })).error.code,
      "conflict",
    );
    const restored = await scopedTool(client, w, "restore_entity", {
      request_key: crypto.randomUUID(),
      id: archived.id,
      schema_version: schema.schema_version,
      expected_version: archived.version,
      properties: { prop_3: "2026-10-09" },
    });
    assertEquals([
      restored.properties.prop_1,
      restored.properties.prop_2,
      restored.properties.prop_4,
      restored.version,
      restored.deleted_at,
    ], ["MCP 보관 대상", 0, "c", 3, null]);
    assertEquals(restored.properties[key], pair);
    assertEquals(
      (await scopedTool(client, w, "update_entity", {
        id: restored.id,
        expected_version: 3,
        schema_version: schema.schema_version,
        properties: { [key]: encodeIdentifierValue(kind, "replacement") },
      })).error.code,
      "invalid_input",
    );
    for (const field of ["source", "external_id", "entity_type_id"]) {
      assertEquals(
        (await scopedTool(client, w, "update_entity", {
          id: restored.id,
          expected_version: 3,
          schema_version: schema.schema_version,
          properties: { prop_1: "금지" },
          [field]: field === "entity_type_id" ? schema.entity_type_id : "replacement",
        })).error.code,
        "invalid_input",
      );
    }
    assertEquals(
      (await scopedHttp(token, w, "GET", `/entities/${encodeURIComponent(created.id)}`)).body.id,
      created.id,
    );
    const events = await scopedTool(client, w, "list_records", {
      entity_id: created.id,
      record_kind: "change",
      limit: 100,
    });
    assertEquals(events.items.length, 3);
    assertEquals(
      new Set(events.items.map((record: { change: { target_id: string } }) => record.change.target_id)),
      new Set([created.id]),
    );
  },
  { mcp: true, typed: true },
);
