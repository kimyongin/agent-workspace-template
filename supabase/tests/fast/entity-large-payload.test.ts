import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/server";
import { entityRoutes } from "../../functions/_shared/adapters/http/entity-routes.ts";
import { entityTypeRoutes } from "../../functions/_shared/adapters/http/entity-type-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { entityTools } from "../../functions/_shared/adapters/mcp/entity-tools.ts";
import { entityTypeTools } from "../../functions/_shared/adapters/mcp/entity-type-tools.ts";
import { registerTools } from "../../functions/_shared/adapters/mcp/tools.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import type { EntityValues } from "../../functions/_shared/contracts/entity.ts";
import type {
  EntityDeps,
  EntityStore,
} from "../../functions/_shared/core/entity/application.ts";
import type {
  EntityTypeDeps,
  EntityTypeStore,
} from "../../functions/_shared/core/entity-types/application.ts";
import {
  jsonbText,
  validateEntityDefinition,
  validateEntityProperties,
} from "../../functions/_shared/core/entity-types/schema-rules.ts";

Deno.test("valid near-64 KiB properties and schema retain every value through GET/default20/max100 HTTP and registered MCP replies, with bounded resumable cursors", async () => {
  const actor = { userId: crypto.randomUUID() }, typeId = crypto.randomUUID();
  const definition = initialEntityDefinition("이름");
  for (let n = 2; n <= 21; n++) {
    definition.schema.properties[`prop_${n}`] = {
      type: "string",
      description: "뜻".repeat(1000),
    };
    definition.display.order.push(`prop_${n}`);
  }
  definition.display.list_columns = [
    "prop_1",
    "prop_2",
    "prop_3",
    "prop_4",
    "prop_5",
    "prop_6",
    "prop_7",
  ];
  validateEntityDefinition(definition);
  const properties: Record<string, string> = {
    prop_1: "대표",
    ...Object.fromEntries(
      Array.from({ length: 5 }, (_, n) => [`prop_${n + 2}`, "한".repeat(4096)]),
    ),
    prop_7: "끝".repeat(1300),
  };
  validateEntityProperties(definition, properties);
  const bytes = (value: unknown) =>
    new TextEncoder().encode(jsonbText(value)).byteLength;
  assert(bytes(properties) > 65000 && bytes(properties) <= 65536);
  assert(bytes(definition) > 60000 && bytes(definition) <= 65536);
  const type = {
    id: typeId,
    label: "긴 자료",
    icon_id: "leaf",
    archived: false,
  };
  const saved = {
    ...definition,
    type,
    type_id: typeId,
    type_version: 1,
    schema_version: 1,
    created_at: "2026-10-12T00:00:00Z",
  };
  const rows: EntityValues[] = Array.from({ length: 101 }, (_, n) => ({
    id: `large:${String(n).padStart(3, "0")}`,
    source: "large",
    external_id: String(n),
    source_label: "large",
    entity_type_id: typeId,
    type,
    schema_version: 1,
    current_schema_version: 1,
    title: "대표",
    properties,
    display_properties: properties,
    tag_ids: [],
    version: 1,
    deleted_at: null,
    created_at: saved.created_at,
    updated_at: saved.created_at,
  }));
  const store = {
    definition: () => Promise.resolve(saved),
    get: (id: string) => Promise.resolve(rows.find((r) => r.id === id) ?? null),
    related: () =>
      Promise.resolve({
        tasks: { count: 0, items: [] },
        records: { count: 0, items: [] },
      }),
    list: (
      q: Parameters<EntityStore["list"]>[0],
      after: Parameters<EntityStore["list"]>[1],
    ) =>
      Promise.resolve(
        rows.slice(after ? rows.findIndex((r) => r.id === after.id) + 1 : 0)
          .slice(0, q.limit).map(({ properties: _all, ...row }) => ({
            ...row,
            _cursor: {
              id: row.id,
              category: 2 as const,
              at: typeof q.sort === "object"
                ? properties.prop_2
                : row.updated_at,
            },
          })),
      ),
  } as unknown as EntityStore;
  const deps: EntityDeps = { uow: { run: (_actor, run) => run(store) } };
  const schemaStore = {
    schema: () => Promise.resolve(saved),
  } as unknown as EntityTypeStore;
  const schemaDeps: EntityTypeDeps = {
    uow: { run: (_actor, run) => run(schemaStore) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", entityRoutes(deps));
  app.route("/", entityTypeRoutes(schemaDeps));
  const schema = await app.request(`/entity-types/${typeId}/schema`);
  assertEquals(schema.status, 200);
  assertEquals((await schema.json()).schema, definition.schema);
  const detail = await app.request("/entities/large:000");
  assertEquals(detail.status, 200);
  assertEquals((await detail.json()).properties, properties);
  for (const limit of [undefined, 100]) {
    const response = await app.request(
      `/entities?entity_type_id=${typeId}${limit ? `&limit=${limit}` : ""}`,
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.items.length, limit ?? 20);
    assert(bytes(body) > 1048576);
    assert(body.next_cursor.length < 24576);
    assertEquals(body.items.at(-1).display_properties, properties);
    const next = await app.request(
      `/entities?entity_type_id=${typeId}&limit=${limit ?? 20}&cursor=${
        encodeURIComponent(body.next_cursor)
      }`,
    );
    assertEquals(next.status, 200);
    assertEquals(
      (await next.json()).items[0].id,
      limit === 100 ? "large:100" : "large:020",
    );
  }
  const registered = new Map<
    string,
    (
      input: Record<string, unknown>,
    ) => Promise<
      { structuredContent: unknown; content: Array<{ text: string }> }
    >
  >();
  registerTools(
    {
      registerTool: (name: string, _info: unknown, callback: unknown) =>
        registered.set(name, callback as never),
    } as unknown as McpServer,
    [...entityTools(deps), ...entityTypeTools(schemaDeps)],
    actor,
  );
  const schemaReply = await registered.get("get_entity_schema")!({
    type_id: typeId,
  });
  assertEquals(
    (schemaReply.structuredContent as typeof saved).schema,
    definition.schema,
  );
  const defaultReply = await registered.get("list_entities")!({
    entity_type_id: typeId,
  });
  const defaultPage = defaultReply.structuredContent as {
    items: EntityValues[];
    next_cursor: string;
  };
  assertEquals(defaultPage.items.length, 20);
  assertEquals(defaultPage.items[19].display_properties, properties);
  assert(bytes(defaultReply) > 1048576);
  assert(defaultPage.next_cursor.length < 24576);
  const query = {
    entity_type_id: typeId,
    limit: 100,
    sort: { key: "prop_2", direction: "asc" },
  };
  const result = await registered.get("list_entities")!(query);
  const page = result.structuredContent as {
    items: EntityValues[];
    next_cursor: string;
  };
  assertEquals(page.items.length, 100);
  assertEquals(page.items[99].display_properties, properties);
  assertEquals(JSON.parse(result.content[0].text), result.structuredContent);
  assert(bytes(result) > 12 * 1024 * 1024);
  assert(page.next_cursor.length < 24576);
  const next = await registered.get("list_entities")!({
    ...query,
    cursor: page.next_cursor,
  });
  assertEquals((next.structuredContent as typeof page).items.map((r) => r.id), [
    "large:100",
  ]);
});
