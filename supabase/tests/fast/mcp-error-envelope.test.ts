import { assertEquals } from "@std/assert";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerTools } from "../../functions/_shared/adapters/mcp/tools.ts";
import { conflict } from "../../functions/_shared/core/shared/errors.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

Deno.test("raw MCP conflict preserves the application error body without connector INVALID_ARGUMENT classification", async () => {
  let call: (() => Promise<unknown>) | undefined;
  const server = {
    registerTool: (_name: string, _options: unknown, handler: () => Promise<unknown>) => {
      call = handler;
    },
  } as unknown as McpServer;
  const error = conflict("최신 버전을 확인하세요");
  registerTools(server, [{
    name: "conflict_probe",
    description: "probe",
    input: z.strictObject({}),
    readOnly: true,
    handler: () => Promise.reject(error),
  }], { userId: "owner" });
  const result = await call!() as { isError: boolean; structuredContent: unknown; content: { text: string }[] };
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent, toErrorBody(error).body);
  assertEquals(JSON.parse(result.content[0].text), toErrorBody(error).body);
  assertEquals("error_code" in (result.structuredContent as object), false);
});
