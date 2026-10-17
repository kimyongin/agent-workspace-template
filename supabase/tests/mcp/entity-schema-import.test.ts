import type { EntitySchema } from "../../functions/_shared/contracts/entity-type.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { claimsOf, connectMcp, mcpToken, tool } from "./_mcp.ts";

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
httpTest("whole-model preview rejects duplicate keys and unsupported schema annotations without writes", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  try {
    const before = (await call(token, "GET", "/data-model/export")).body;
    const schema =
      initialEntityDefinition("이름", { id: crypto.randomUUID(), title: "Invalid import", icon: "box" }).schema;
    const document = JSON.stringify(bundle(schema));
    const duplicate = {
      mode: "copy",
      document: document.replace('"title":"Invalid import"', '"title":"first","title":"second"'),
    };
    const http = await call(token, "POST", "/data-model/preview", duplicate, null);
    assertEquals(http.status, 400);
    assertEquals(http.body.code, "invalid_input");
    assert(http.body.fields.length > 0);
    const mcp = await tool(client, "preview_data_model", duplicate);
    assertEquals(mcp.error, http.body);
    const unsupported = {
      mode: "copy",
      document: JSON.stringify(bundle({ ...schema, $ref: "https://example.invalid/schema" } as EntitySchema)),
    };
    const rejected = await call(token, "POST", "/data-model/preview", unsupported, null);
    assertEquals(rejected.status, 400);
    assertEquals((await tool(client, "preview_data_model", unsupported)).error, rejected.body);
    assertEquals((await call(token, "POST", "/entity-schema-import/preview", duplicate, null)).status, 404);
    assertEquals(
      (await call(token, "POST", "/entity-schema-import/prepare", {
        ...duplicate,
        preview_fingerprint: "0".repeat(64),
      })).status,
      400,
    );
    assertEquals((await call(token, "GET", "/data-model/export")).body, before);
  } finally {
    await client.close();
  }
});
httpTest(
  "retired import HTTP/MCP replays exact historical results and rejects changed, foreign or new requests",
  async () => {
    const token = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(token));
    const owner = String(claimsOf(token).sub), key = crypto.randomUUID();
    const raw = { mode: "copy", document: "{}", preview_fingerprint: "b".repeat(64), new_keys: [], remove_keys: [] };
    const identity = await requestIdentity(
      { userId: owner, request: { key } },
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
    try {
      await admin`insert into private.request_results(owner_id,request_key,operation,fingerprint,result,completed_at) values(${owner},${key}::uuid,${identity.operation},${identity.fingerprint},${
        admin.json(original)
      },now())`;
      const response = await call(token, "POST", "/entity-schema-import/prepare", raw, key);
      assertEquals(response.status, 200);
      assertEquals(response.body, original);
      assertEquals(await tool(client, "prepare_entity_schema_import", { ...raw, request_key: key }), original);
      assertEquals(
        (await call(token, "POST", "/entity-schema-import/prepare", { ...raw, document: "[]" }, key)).status,
        409,
      );
      assertEquals((await call(other, "POST", "/entity-schema-import/prepare", raw, key)).status, 400);
      assertEquals((await call(token, "POST", "/entity-schema-import/prepare", raw, crypto.randomUUID())).status, 400);
    } finally {
      await client.close();
      await admin`delete from private.request_results where owner_id=${owner} and request_key=${key}::uuid`;
    }
  },
);

httpTest(
  "readonly imported defaults: HTTP/MCP memo preparation returns writable input while resolving server defaults",
  async () => {
    const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
    const owner = String(claimsOf(token).sub), run = crypto.randomUUID(), keys: string[] = [];
    let typeId: string | undefined, modelChangeId: string | undefined;
    const key = () => {
      const value = crypto.randomUUID();
      keys.push(value);
      return value;
    };
    try {
      const schema = initialEntityDefinition("이름", {
        id: crypto.randomUUID(),
        title: `readonly preparation ${run}`,
        icon: "box",
      }).schema;
      Object.assign(schema.properties.prop_1, { readOnly: true, default: "Auto" });
      schema.properties.prop_2 = { type: "string", "x-order": 20, readOnly: true, default: "LOCKED" };
      schema.properties.prop_3 = { type: "string", "x-order": 30 };
      const copy = { mode: "copy", document: JSON.stringify(bundle(schema)) };
      const preview = await call(token, "POST", "/data-model/preview", copy, null);
      assertEquals(preview.status, 200);
      const prepared = await tool(client, "prepare_data_model", {
        ...copy,
        preview_fingerprint: preview.body.fingerprint,
        request_key: key(),
      });
      modelChangeId = prepared.id;
      assert(modelChangeId);
      const applied = await tool(client, "apply_data_model", {
        id: prepared.id,
        expected_version: prepared.version,
        request_key: key(),
      });
      assertEquals(applied.status, "applied", JSON.stringify(applied));
      typeId = applied.result.type_ids[0];
      assert(typeId);
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
        const http = await call(token, "POST", "/records/prepare", input, null);
        assertEquals(http.status, 200);
        const mcp = await tool(client, "prepare_record_memo", input);
        assertEquals(mcp, http.body);
        assertEquals(mcp.prepared_input.properties, { prop_3: "human" });
        assert(mcp.change_note.includes("Auto"), "memo must use the resolved readonly representative");
        const payload = { ...mcp.prepared_input, change_note: mcp.change_note, change_tag_ids: mcp.change_tag_ids };
        const requestKey = key();
        const saved = transport === "http"
          ? await call(token, "POST", "/entities", payload, requestKey)
          : { status: 201, body: await tool(client, "create_entity", { ...payload, request_key: requestKey }) };
        assertEquals(saved.status, 201);
        assertEquals(saved.body.properties, { prop_1: "Auto", prop_2: "LOCKED", prop_3: "human" });
        assertEquals(saved.body.title, "Auto");
        const replay = transport === "http"
          ? await tool(client, "create_entity", { ...payload, request_key: requestKey })
          : (await call(token, "POST", "/entities", payload, requestKey)).body;
        assertEquals(replay, saved.body);
        assertEquals((await tool(client, "get_entity", { id: saved.body.id })).properties, saved.body.properties);
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
      const rejected = await call(token, "POST", "/records/prepare", bad, null);
      assertEquals(rejected.status, 400);
      assertEquals(rejected.body.code, "invalid_input");
      assertEquals(rejected.body.fields[0].path, "properties.prop_2");
      assertEquals((await tool(client, "prepare_record_memo", bad)).error, rejected.body);
    } finally {
      await client.close();
      if (modelChangeId) {
        await admin`delete from app.data_model_changes where owner_id=${owner} and id=${modelChangeId}::uuid`;
      }
      if (typeId) {
        await admin.begin(async (tx) => {
          const entities = await tx`select id from app.entities where owner_id=${owner} and entity_type_id=${typeId!}`;
          const ids = entities.map((row) => String(row.id));
          const records =
            await tx`select id from app.records where owner_id=${owner} and change_metadata->>'target_kind'='entity' and change_metadata->>'target_id'=any(${ids}::text[])`;
          const recordIds = records.map((row) => String(row.id));
          await tx`delete from private.request_results where owner_id=${owner} and request_key=any(${keys}::uuid[])`;
          await tx`delete from pgmq.q_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from pgmq.a_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from private.passage_effects where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_chunks where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_index_state where owner_id=${owner} and kind='record' and id=any(${recordIds}::text[])`;
          await tx`delete from app.records where owner_id=${owner} and id=any(${recordIds}::text[])`;
          await tx`delete from app.entities where owner_id=${owner} and entity_type_id=${typeId!}`;
          await tx`delete from app.entity_types where owner_id=${owner} and id=${typeId!}`;
        });
      }
    }
  },
);
