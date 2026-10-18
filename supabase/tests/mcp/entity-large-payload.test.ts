import { assert, assertEquals } from "@std/assert";
import { admin, API, type Res } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp } from "../http/_workspace-activity-fixture.ts";
import { grantOwnedKinds } from "./_workspace-grants.ts";
import type { EntityDetail, EntitySummary } from "../../functions/_shared/contracts/entity.ts";
import type { EntitySchemaResult } from "../../functions/_shared/contracts/entity-type.ts";
import type { EntitySchemaChange } from "../../functions/_shared/contracts/entity-schema-change.ts";
import {
  jsonbText,
  validateEntityDefinition,
  validateEntityProperties,
} from "../../functions/_shared/core/entity-types/schema-rules.ts";

type Page = { items: EntitySummary[]; next_cursor: string | null };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

activityWorkspaceSuite(
  "large typed pages actual HTTP/OAuth SDK preserve schema and near-64KiB properties default20/max100 and long cursors",
  async ({ A: token, B: foreign, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const run = crypto.randomUUID(), entities: string[] = [];
    const key = () => crypto.randomUUID();
    const evidence: Record<string, number | string> = { run };
    const request = <T>(
      session: string,
      workspace: string,
      method: string,
      path: string,
      body?: unknown,
      requestKey: string | null = crypto.randomUUID(),
    ) => scopedHttp(session, workspace, method, path, body, requestKey) as Promise<Res<T>>;
    const catalog = await client.listTools(),
      names = catalog.tools.map((t) => t.name);
    assertEquals(new Set(names).size, names.length);
    for (
      const name of [
        "get_entity_schema",
        "export_data_model",
        "preview_data_model",
        "prepare_data_model",
        "apply_data_model",
        "list_entity_relation_definitions",
        "list_entity_relation_links",
        "create_and_link_entity",
        "list_entities",
        "get_entity",
        "create_entity",
        "analyze_entity_schema_change",
        "apply_entity_schema_change",
        "delete_entity_issuer",
        "delete_entity_identifier_rule",
      ]
    ) assert(names.includes(name));
    assertEquals(
      catalog.tools.find((t) => t.name === "list_entities")?.annotations
        ?.readOnlyHint,
      true,
    );
    evidence.tools = names.length;
    const sdk = async <T>(name: string, args: Record<string, unknown>) => {
      const response = await client!.callTool({ name, arguments: { workspace_id: w, ...args } });
      assert(response.isError !== true, `${name} must succeed`);
      assert(
        response.structuredContent,
        `${name} must return structured content`,
      );
      const text = response.content.find((block) => block.type === "text");
      assert(text?.type === "text");
      assertEquals(JSON.parse(text.text), response.structuredContent);
      return {
        body: response.structuredContent as T,
        bytes: bytes(response),
      };
    };
    const created = await request<
      { id: string; schema_version: number }
    >(token, w, "POST", "/entity-types", {
      label: `large351 ${run}`,
      representative_label: "이름",
      icon_id: "leaf",
    }, key());
    assertEquals(created.status, 201);
    const typeId = created.body.id;
    await grantOwnedKinds(token, w, [typeId]);
    const input = {
      expected_schema_version: created.body.schema_version,
      edits: [
        ...Array.from(
          { length: 22 },
          (_, n) => ({
            op: "add_property",
            client_ref: `field${n + 2}`,
            field: {
              type: "string",
              "x-order": (n + 2) * 10,
              "x-show-in-list": n < 6,
              description: "뜻".repeat(n === 21 ? 100 : 1000),
            },
            required: false,
          }),
        ),
      ],
    };
    const plan = await request<EntitySchemaChange>(
      token,
      w,
      "POST",
      `/entity-types/${typeId}/schema-changes`,
      input,
      key(),
    );
    assertEquals(plan.status, 201);
    validateEntityDefinition(plan.body.target);
    const definitionBytes = new TextEncoder().encode(jsonbText(plan.body.target)).byteLength;
    assert(definitionBytes > 65000 && definitionBytes <= 262144);
    evidence.definition_bytes = definitionBytes;
    const accepted = await sdk<{ analysis_id: string; status: string }>(
      "analyze_entity_schema_change",
      {
        type_id: typeId,
        change_id: plan.body.id,
        expected_change_version: plan.body.version,
        request_key: key(),
      },
    );
    assertEquals(accepted.body.status, "queued");
    // Empty types finish at acceptance; no privileged worker claim is needed.
    const ready = await request<EntitySchemaChange>(
      token,
      w,
      "GET",
      `/entity-types/${typeId}/schema-changes/${plan.body.id}`,
    );
    assertEquals(ready.status, 200);
    assertEquals(ready.body.analysis?.status, "succeeded");
    assertEquals(ready.body.analysis?.id, accepted.body.analysis_id);
    assertEquals(ready.body.analysis?.total, 0);
    assert(ready.body.executable);
    await sdk("apply_entity_schema_change", {
      type_id: typeId,
      change_id: plan.body.id,
      expected_change_version: ready.body.version,
      analysis_id: ready.body.analysis!.id,
      request_key: key(),
    });
    const schema = await request<EntitySchemaResult>(
      token,
      w,
      "GET",
      `/entity-types/${typeId}/schema`,
    );
    assertEquals(schema.status, 200);
    assertEquals(schema.body.schema, {
      ...plan.body.target.schema,
      "x-version": schema.body.schema_version,
    });
    assertEquals(
      (await sdk<EntitySchemaResult>("get_entity_schema", {
        type_id: typeId,
      })).body,
      schema.body,
    );
    assertEquals(
      (await request(foreign, otherW, "GET", `/entity-types/${typeId}/schema`)).status,
      404,
    );
    const properties: Record<string, string> = {
      prop_1: "대표",
      ...Object.fromEntries(
        Array.from(
          { length: 5 },
          (_, n) => [`prop_${n + 2}`, "한".repeat(4096)],
        ),
      ),
      prop_7: "끝".repeat(1300),
    };
    validateEntityProperties({
      schema: schema.body.schema,
    }, properties);
    evidence.properties_bytes = new TextEncoder().encode(jsonbText(properties)).byteLength;
    assertEquals(evidence.properties_bytes, 65444);
    for (let n = 0; n < 101; n++) {
      const entity = await request<EntityDetail>(token, w, "POST", "/entities", {
        entity_type_id: typeId,
        schema_version: schema.body.schema_version,
        properties,
        change_note: "큰 응답 검증",
      }, key());
      assertEquals(entity.status, 201);
      entities.push(entity.body.id);
      assertEquals(entity.body.properties, properties);
    }
    const detail = await request<EntityDetail>(
      token,
      w,
      "GET",
      `/entities/${encodeURIComponent(entities[0])}`,
    );
    assertEquals(detail.status, 200);
    assertEquals(detail.body.properties, properties);
    assertEquals(
      (await sdk<EntityDetail>("get_entity", { id: entities[0] })).body,
      detail.body,
    );
    assertEquals(
      (await request(
        foreign,
        otherW,
        "GET",
        `/entities/${encodeURIComponent(entities[0])}`,
      )).status,
      404,
    );
    const [readBaseline] =
      await admin`select (select count(*) from private.workspace_request_results where workspace_id=${w})::int as requests,(select count(*) from app.records where workspace_id=${w} and change_metadata->>'target_id'=any(${entities}::text[]))::int as records,(select count(*) from app.entities where workspace_id=${w} and entity_type_id=${typeId!})::int as entities`;
    const httpPage = async (query: Record<string, unknown>, bodyQuery = false) => {
      const params = new URLSearchParams(
        Object.entries(query).map((
          [name, value],
        ) => [
          name,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ]),
      );
      const response = await fetch(bodyQuery ? `${API}/entities/query` : `${API}/entities?${params}`, {
        method: bodyQuery ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "X-Workspace-Id": w,
          ...(bodyQuery ? { "content-type": "application/json" } : {}),
        },
        ...(bodyQuery ? { body: JSON.stringify(query) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      assertEquals(response.status, 200);
      const raw = new Uint8Array(await response.arrayBuffer());
      return {
        body: JSON.parse(new TextDecoder().decode(raw)) as Page,
        bytes: raw.byteLength,
      };
    };
    const assertPage = (page: Page, count: number) => {
      assertEquals(page.items.length, count);
      for (const item of page.items) {
        assertEquals(item.display_properties, properties);
        assertEquals("properties" in item, false);
        assertEquals(item.entity_type_id, typeId);
      }
    };
    for (const limit of [undefined, 100]) {
      const query = { entity_type_id: typeId, ...(limit ? { limit } : {}) };
      const http = await httpPage(query),
        mcp = await sdk<Page>("list_entities", query);
      assertPage(http.body, limit ?? 20);
      assertPage(mcp.body, limit ?? 20);
      assertEquals(mcp.body, http.body);
      assertEquals((await httpPage(query, true)).body, http.body);
      assert(http.bytes > 1048576);
      assert(mcp.bytes > 1048576);
      if (limit === 100) assert(mcp.bytes > 12 * 1024 * 1024);
      evidence[`http_${limit ?? 20}_bytes`] = http.bytes;
      evidence[`sdk_${limit ?? 20}_bytes`] = mcp.bytes;
    }
    const query = {
      entity_type_id: typeId,
      limit: 100,
      sort: { key: "prop_2", direction: "asc" },
    };
    const first = await httpPage(query),
      mcpFirst = await sdk<Page>("list_entities", query);
    assertPage(first.body, 100);
    assertEquals(first.body, mcpFirst.body);
    assert(first.body.next_cursor);
    assert(mcpFirst.body.next_cursor);
    assert(
      first.body.next_cursor.length > 16000 &&
        first.body.next_cursor.length < 24576,
    );
    evidence.cursor_length = first.body.next_cursor.length;
    const mcpNext = await sdk<Page>("list_entities", {
      ...query,
      cursor: first.body.next_cursor,
    });
    const httpNext = await httpPage({
      ...query,
      cursor: mcpFirst.body.next_cursor,
    }, true);
    assertPage(mcpNext.body, 1);
    assertEquals(mcpNext.body, httpNext.body);
    assertEquals(mcpNext.body.next_cursor, null);
    const all = [...first.body.items, ...mcpNext.body.items].map((item) => item.id);
    assertEquals(new Set(all).size, 101);
    assertEquals(all.sort(), entities.toSorted());
    const afterCreation = (await request<EntitySchemaResult>(token, w, "GET", `/entity-types/${typeId}/schema`)).body;
    const { identity: initialIdentity, ...initialDefinition } = schema.body;
    const { identity: referencedIdentity, ...unchangedDefinition } = afterCreation;
    assertEquals(unchangedDefinition, initialDefinition);
    assert(initialIdentity && referencedIdentity);
    assertEquals(initialIdentity.sources.find((source) => source.code === "app")?.referenced, false);
    assertEquals(referencedIdentity.sources.find((source) => source.code === "app")?.referenced, true);
    assertEquals(referencedIdentity.version, initialIdentity.version);
    const filtered = {
      entity_type_id: typeId,
      limit: 100,
      filters: [{ key: "prop_2", operator: "eq", value: "한".repeat(4096) }],
    };
    assertEquals((await httpPage(filtered, true)).body, (await sdk<Page>("list_entities", filtered)).body);
    for (
      const invalid of [{ entity_type_id: typeId, limit: 101 }, { entity_type_id: typeId, cursor: "invalid" }, {
        owner_id: "other",
      }, { entity_type_id: typeId, filters: [{ key: "prop_2", operator: "eq", value: 0 }] }]
    ) {
      const params = new URLSearchParams(
        Object.entries(invalid).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
      );
      const get = await request(token, w, "GET", `/entities?${params}`);
      const post = await request(token, w, "POST", "/entities/query", invalid, null);
      assertEquals(post.status, 400);
      assertEquals(post.body, get.body);
      const mcp = await client!.callTool({ name: "list_entities", arguments: { workspace_id: w, ...invalid } });
      assertEquals(mcp.isError, true);
      assertEquals(mcp.structuredContent, post.body);
    }
    assertEquals(
      (await request(foreign, otherW, "POST", "/entities/query", { entity_type_id: typeId }, null)).status,
      404,
    );
    const [readAfter] =
      await admin`select (select count(*) from private.workspace_request_results where workspace_id=${w})::int as requests,(select count(*) from app.records where workspace_id=${w} and change_metadata->>'target_id'=any(${entities}::text[]))::int as records,(select count(*) from app.entities where workspace_id=${w} and entity_type_id=${typeId!})::int as entities`;
    assertEquals(readAfter, readBaseline);
    evidence.post_query_read_only = "no ledger, records or entity writes";
    console.log(JSON.stringify(evidence));
  },
  { mcp: true },
);
