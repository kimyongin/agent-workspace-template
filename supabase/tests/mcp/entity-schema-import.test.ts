import type { EntitySchema } from "../../functions/_shared/contracts/entity-type.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { assert, assertEquals } from "@std/assert";
import { admin } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { grantOwnedKinds } from "./_workspace-grants.ts";
import { claimsOf } from "./_mcp.ts";

function bundle(schema: EntitySchema): DataModelDocument {
  return {
    format: "workspace-data-model",
    format_version: 1,
    title: "import validation",
    entity_types: [{
      ref: "item",
      schema,
      identity: {
        version: 1,
        label: "번호",
        default_source: "app",
        sources: [{ code: "app", rule_id: "00000000-0000-4000-8000-000000000001", active: true }],
      },
    }],
    relations: [],
    identity_definitions: {
      issuers: [{ code: "app", label: "앱", active: true, system: true, version: 1 }],
      rules: [{
        id: "00000000-0000-4000-8000-000000000001",
        source: "app",
        label: "자동 발급",
        meaning: "앱이 발급한 자료 번호",
        generation: "automatic",
        active: true,
        version: 1,
      }],
    },
  };
}
// Full copy/update/replay/ownership parity continues in data-model.test.ts.
activityWorkspaceSuite(
  "whole-model preview rejects duplicate keys and unsupported schema annotations without writes",
  async ({ A: token, workspaceA: w, clientA: client }) => {
    assert(client);
    const before = (await scopedHttp(token, w, "GET", "/data-model/export")).body;
    const schema =
      initialEntityDefinition("이름", { id: crypto.randomUUID(), title: "Invalid import", icon: "box" }).schema;
    const document = JSON.stringify(bundle(schema));
    const duplicate = {
      mode: "copy",
      document: document.replace('"title":"Invalid import"', '"title":"first","title":"second"'),
    };
    const http = await scopedHttp(token, w, "POST", "/data-model/preview", duplicate, null);
    assertEquals(http.status, 400);
    assertEquals(http.body.code, "invalid_input");
    assert(http.body.fields.length > 0);
    const mcp = await scopedTool(client, w, "preview_data_model", duplicate);
    assertEquals(mcp.error, http.body);
    const unsupported = {
      mode: "copy",
      document: JSON.stringify(bundle({ ...schema, $ref: "https://example.invalid/schema" } as EntitySchema)),
    };
    const rejected = await scopedHttp(token, w, "POST", "/data-model/preview", unsupported, null);
    assertEquals(rejected.status, 400);
    assertEquals((await scopedTool(client, w, "preview_data_model", unsupported)).error, rejected.body);
    assertEquals((await scopedHttp(token, w, "POST", "/entity-schema-import/preview", duplicate, null)).status, 404);
    assertEquals(
      (await scopedHttp(token, w, "POST", "/entity-schema-import/prepare", {
        ...duplicate,
        preview_fingerprint: "0".repeat(64),
      })).status,
      400,
    );
    assertEquals((await scopedHttp(token, w, "GET", "/data-model/export")).body, before);
  },
  { mcp: true },
);
activityWorkspaceSuite(
  "retired import HTTP/MCP replays exact historical results and rejects changed, foreign or new requests",
  async ({ A: token, B: other, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const owner = String(claimsOf(token).sub), key = crypto.randomUUID();
    const raw = { mode: "copy", document: "{}", preview_fingerprint: "b".repeat(64), new_keys: [], remove_keys: [] };
    const identity = await requestIdentity(
      { userId: owner, workspaceId: w, request: { key } },
      "entity-schema-import.prepare",
      null,
      raw,
    );
    const original = {
      changed: true,
      type: { id: crypto.randomUUID(), schema_version: 1 },
      key_mapping: { prop_9: "prop_1" },
      change: null,
    };
    await admin`insert into private.workspace_request_results(executor_id,workspace_id,request_key,operation,fingerprint,footprint,result,completed_at) values(${owner},${w},${key}::uuid,${identity.operation},${identity.fingerprint},'[{"target_kind":"settings","target_id":"*","access":"write"}]'::jsonb,${
      admin.json(original)
    },now())`;
    const response = await scopedHttp(token, w, "POST", "/entity-schema-import/prepare", raw, key);
    assertEquals(response.status, 200);
    assertEquals(response.body, original);
    assertEquals(await scopedTool(client, w, "prepare_entity_schema_import", { ...raw, request_key: key }), original);
    assertEquals(
      (await scopedHttp(token, w, "POST", "/entity-schema-import/prepare", { ...raw, document: "[]" }, key)).status,
      409,
    );
    assertEquals((await scopedHttp(other, otherW, "POST", "/entity-schema-import/prepare", raw, key)).status, 400);
    assertEquals(
      (await scopedHttp(token, w, "POST", "/entity-schema-import/prepare", raw, crypto.randomUUID())).status,
      400,
    );
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "readonly imported defaults: HTTP/MCP memo preparation returns writable input while resolving server defaults",
  async ({ A: token, workspaceA: w, clientA: client }) => {
    assert(client);
    const run = crypto.randomUUID();
    const key = () => crypto.randomUUID();
    const schema = initialEntityDefinition("이름", {
      id: crypto.randomUUID(),
      title: `readonly preparation ${run}`,
      icon: "box",
    }).schema;
    Object.assign(schema.properties.prop_1, { readOnly: true, default: "Auto" });
    schema.properties.prop_2 = { type: "string", "x-order": 20, readOnly: true, default: "LOCKED" };
    schema.properties.prop_3 = { type: "string", "x-order": 30 };
    const copy = { mode: "copy", document: JSON.stringify(bundle(schema)) };
    const preview = await scopedHttp(token, w, "POST", "/data-model/preview", copy, null);
    assertEquals(preview.status, 200);
    const prepared = await scopedTool(client, w, "prepare_data_model", {
      ...copy,
      preview_fingerprint: preview.body.fingerprint,
      request_key: key(),
    });
    const modelChangeId = prepared.id;
    assert(modelChangeId);
    const applied = await scopedTool(client, w, "apply_data_model", {
      id: prepared.id,
      expected_version: prepared.version,
      request_key: key(),
    });
    assertEquals(applied.status, "applied", JSON.stringify(applied));
    const typeId = applied.result.type_ids[0];
    assert(typeId);
    await grantOwnedKinds(token, w, [typeId]);
    for (const transport of ["http", "mcp"] as const) {
      const input = {
        model: "entity",
        action: "create",
        input: {
          entity_type_id: typeId,
          schema_version: 1,
          external_id: `${transport}-${run}`,
          properties: { prop_3: "human" },
        },
      };
      const http = await scopedHttp(token, w, "POST", "/records/prepare", input, null);
      assertEquals(http.status, 200);
      const mcp = await scopedTool(client, w, "prepare_record_memo", input);
      assertEquals(mcp, http.body);
      assertEquals(mcp.prepared_input.properties, { prop_3: "human" });
      assert(mcp.change_note.includes("Auto"), "memo must use the resolved readonly representative");
      const payload = { ...mcp.prepared_input, change_note: mcp.change_note, change_tag_ids: mcp.change_tag_ids };
      const requestKey = key();
      const saved = transport === "http"
        ? await scopedHttp(token, w, "POST", "/entities", payload, requestKey)
        : { status: 201, body: await scopedTool(client, w, "create_entity", { ...payload, request_key: requestKey }) };
      assertEquals(saved.status, 201);
      assertEquals(saved.body.properties, { prop_1: "Auto", prop_2: "LOCKED", prop_3: "human" });
      assertEquals(saved.body.title, "Auto");
      const replay = transport === "http"
        ? await scopedTool(client, w, "create_entity", { ...payload, request_key: requestKey })
        : (await scopedHttp(token, w, "POST", "/entities", payload, requestKey)).body;
      assertEquals(replay, saved.body);
      assertEquals(
        (await scopedTool(client, w, "get_entity", { id: saved.body.id })).properties,
        saved.body.properties,
      );
    }
    const bad = {
      model: "entity",
      action: "create",
      input: {
        entity_type_id: typeId,
        schema_version: 1,
        external_id: `invalid-${run}`,
        properties: { prop_2: "LOCKED" },
      },
    };
    const rejected = await scopedHttp(token, w, "POST", "/records/prepare", bad, null);
    assertEquals(rejected.status, 400);
    assertEquals(rejected.body.code, "invalid_input");
    assertEquals(rejected.body.fields[0].path, "properties.prop_2");
    assertEquals((await scopedTool(client, w, "prepare_record_memo", bad)).error, rejected.body);
  },
  { mcp: true },
);
