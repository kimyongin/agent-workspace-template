import { assertEquals } from "@std/assert";
import { assert } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { httpEntityFixture } from "../http/_entity.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest(
  "task kinds: actual HTTP/MCP handlers and memo preparation reject invalid combinations with repair guidance",
  async () => {
    const session = await signIn("A"), client = await connectMcp(await mcpToken(session));
    const ids: string[] = [];
    try {
      for (
        const [input, repair] of [
          [{ kind: "once", title: "입력 점검", timezone: "Asia/Seoul" }, "제거하세요"],
          [{ kind: "once", title: "입력 점검", recurrence: { freq: "daily", starts_on: "2026-10-11" } }, "제거하세요"],
          [{ kind: "recurring", title: "입력 점검" }, "입력하세요"],
          [{
            kind: "recurring",
            title: "입력 점검",
            timezone: "Asia/Seoul",
            recurrence: { freq: "daily", starts_on: "2026-10-11" },
            due_on: "2026-10-12",
          }, "제거하고"],
        ] as const
      ) {
        const http = await call(session, "POST", "/tasks", input), mcp = await tool(client, "create_task", input);
        assertEquals(http.status, 400);
        assertEquals(mcp.error, http.body);
        assert(mcp.error.fields.some((field: { message: string }) => field.message.includes(repair)));
        const prepared = await tool(client, "prepare_record_memo", { model: "task", action: "create", input });
        assertEquals(prepared.error.code, "invalid_input");
        assert(prepared.error.fields.some((field: { message: string }) => field.message.includes(repair)));
      }
      for (
        const input of [{ kind: "once", title: "유효 입력", due_on: "2026-10-12" }, {
          kind: "recurring",
          title: "유효 입력",
          timezone: "Asia/Seoul",
          recurrence: { freq: "daily", starts_on: "2026-10-11" },
        }]
      ) {
        const prepared = await tool(client, "prepare_record_memo", { model: "task", action: "create", input });
        assertEquals(prepared.error, undefined);
        const created = await tool(client, "create_task", {
          ...prepared.prepared_input,
          change_note: prepared.change_note,
          change_tag_ids: prepared.change_tag_ids,
        });
        assertEquals(created.error, undefined);
        ids.push(created.id);
        assertEquals(created.kind, input.kind);
      }
    } finally {
      for (const id of ids) await tool(client, "delete_task", { id, expected_version: 1 });
      await client.close();
    }
  },
);

httpTest("OAuth MCP rejects missing request keys and client IDs/retired metadata/upsert tool", async () => {
  const session = await signIn("A");
  const schema = await httpEntityFixture(session);
  const client = await connectMcp(await mcpToken(session));
  try {
    const { tools } = await client.listTools();
    assertEquals(tools.some((t) => t.name.includes("principle")), false);
    for (
      const [name, content] of [
        ["create_entity", { ...schema, properties: { prop_1: "입력 거부" } }],
        ["create_task", { kind: "once", title: "입력 거부" }],
        ["create_record", { body: "입력 거부" }],
        ["create_tag", { name: "입력 거부" }],
      ] as const
    ) {
      assertEquals((await tool(client, name, { request_key: undefined, ...content })).error.code, "invalid_input");
      assertEquals(
        (await tool(client, name, {
          id: crypto.randomUUID(),
          ...content,
          request_id: crypto.randomUUID(),
        })).error.code,
        "invalid_input",
      );
    }
  } finally {
    await client.close();
  }
});
