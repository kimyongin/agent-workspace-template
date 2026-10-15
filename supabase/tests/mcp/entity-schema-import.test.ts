import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("schema import HTTP/MCP: copy mapping, reviewed draft, stale source, no-op and ownership", async () => {
  const token = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(token));
  const ids: string[] = [];
  try {
    const source = (await call(token, "POST", "/entity-types", { label: "import source " + crypto.randomUUID() })).body;
    ids.push(source.id);
    const original = (await call(token, "GET", `/entity-types/${source.id}/schema`)).body.schema;
    const copiedDocument = structuredClone(original);
    copiedDocument.title = "import copy " + crypto.randomUUID();
    copiedDocument.properties = { prop_9: copiedDocument.properties.prop_1 };
    copiedDocument.required = ["prop_9"];
    const copy = { mode: "copy", document: JSON.stringify(copiedDocument, null, 2) };
    const preview = await call(token, "POST", "/entity-schema-import/preview", copy, null);
    assertEquals(preview.status, 200);
    assertEquals(preview.body.key_mapping, { prop_9: "prop_1" });
    assertEquals(preview.body.schema.required, ["prop_1"]);
    assertEquals(await tool(client, "preview_entity_schema_import", copy), preview.body);
    const key = crypto.randomUUID(), preparedInput = { ...copy, preview_fingerprint: preview.body.preview_fingerprint };
    const prepared = await call(token, "POST", "/entity-schema-import/prepare", preparedInput, key);
    assertEquals(prepared.status, 201);
    const created = prepared.body.type;
    ids.push(created.id);
    assertNotEquals(created.id, source.id);
    assertEquals(created.schema_version, 1);
    assertEquals(prepared.body.schema["x-type-id"], created.id);
    assertEquals(prepared.body.schema["x-version"], 1);
    assertEquals(prepared.body.schema.required, ["prop_1"]);
    assertEquals(
      await tool(client, "prepare_entity_schema_import", { ...preparedInput, request_key: key }),
      prepared.body,
    );
    const exported = (await tool(client, "get_entity_schema", { type_id: created.id })).schema;
    assertEquals(exported, prepared.body.schema);
    const unchanged = {
      mode: "update",
      type_id: created.id,
      expected_schema_version: 1,
      document: JSON.stringify(exported),
    };
    const same = (await call(token, "POST", "/entity-schema-import/preview", unchanged, null)).body;
    assertEquals(same.changed, false);
    const noChange = await call(token, "POST", "/entity-schema-import/prepare", {
      ...unchanged,
      preview_fingerprint: same.preview_fingerprint,
    });
    assertEquals(noChange.status, 201);
    assertEquals(noChange.body.changed, false);
    assertEquals(noChange.body.change, null);
    assertEquals((await call(token, "GET", `/entity-types/${created.id}/schemas`)).body.items.length, 1);
    const edited = structuredClone(exported);
    edited.properties.prop_1.title = "가져온 이름";
    edited.properties.prop_27 = { type: ["integer", "null"], title: "수량", minimum: 0, multipleOf: 2, "x-order": 20 };
    const update = { ...unchanged, document: JSON.stringify(edited) };
    const review = (await call(token, "POST", "/entity-schema-import/preview", update, null)).body;
    assertEquals(review.key_mapping.prop_27, "prop_2");
    assertEquals(review.source_is_stale, false);
    const writeKey = crypto.randomUUID();
    const writeInput = { ...update, preview_fingerprint: review.preview_fingerprint };
    const draft = await tool(client, "prepare_entity_schema_import", { ...writeInput, request_key: writeKey });
    assert(draft.change.id);
    assertEquals(draft.change.status, "draft");
    const storedDraft =
      (await call(token, "GET", `/entity-types/${created.id}/schema-changes/${draft.change.id}`)).body;
    assertEquals(storedDraft.target.schema.properties.prop_2.multipleOf, 2);
    assertEquals((await call(token, "POST", "/entity-schema-import/prepare", writeInput, writeKey)).body, draft);
    assertEquals((await call(token, "GET", `/entity-types/${created.id}/schema`)).body.schema, exported);
    assertEquals((await call(other, "POST", "/entity-schema-import/preview", unchanged, null)).status, 404);
    assertEquals(
      (await call(token, "POST", "/entity-schema-import/preview", { ...update, type_id: source.id }, null)).status,
      400,
    );
    const renamed = await call(token, "PATCH", `/entity-types/${created.id}`, {
      expected_schema_version: 1,
      label: "new head " + crypto.randomUUID(),
    });
    assertEquals(renamed.status, 200);
    assertEquals((await call(token, "POST", "/entity-schema-import/prepare", writeInput)).status, 409);
    const oldSource = await call(token, "POST", "/entity-schema-import/preview", {
      ...unchanged,
      expected_schema_version: 2,
    }, null);
    assertEquals(oldSource.status, 200);
    assertEquals(oldSource.body.source_schema_version, 1);
    assertEquals(oldSource.body.current_schema_version, 2);
    assertEquals(oldSource.body.source_is_stale, true);
    assert(oldSource.body.changed);
  } finally {
    await client.close();
    for (const id of ids.reverse()) await admin`delete from app.entity_types where id=${id}`;
  }
});

httpTest("schema import rejects duplicate JSON keys and unsupported annotations without writes", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  try {
    const duplicate = { mode: "copy", document: '{"properties":{"prop_1":{"title":"a","title":"b"}}}' };
    const http = await call(token, "POST", "/entity-schema-import/preview", duplicate, null);
    assertEquals(http.status, 400);
    assertEquals(http.body.code, "invalid_input");
    assert(http.body.fields?.length > 0);
    const mcp = await tool(client, "preview_entity_schema_import", duplicate);
    assertEquals(mcp.error.code, http.body.code);
    assertEquals(mcp.error.fields, http.body.fields);
    const unsupported = { mode: "copy", document: '{"$ref":"https://example.invalid/schema"}' };
    assertEquals((await call(token, "POST", "/entity-schema-import/preview", unsupported, null)).status, 400);
    assertEquals(
      (await call(token, "POST", "/entity-schema-import/prepare", {
        ...duplicate,
        preview_fingerprint: "0".repeat(64),
      })).status,
      400,
    );
  } finally {
    await client.close();
  }
});
