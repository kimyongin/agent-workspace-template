import { assertEquals } from "@std/assert";
import { z } from "zod";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { registerTools } from "../../functions/_shared/adapters/mcp/tools.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { requestKey } from "../../functions/_shared/contracts/request.ts";
import type { McpServer } from "@modelcontextprotocol/server";

Deno.test("registered MCP task schema preserves once/recurring constraints under the object envelope", () => {
  let schema: Record<string, unknown> = {};
  const server = {
    registerTool: (_name: string, options: {
      inputSchema: {
        "~standard": {
          jsonSchema: {
            input: (options: { target: string }) => Record<string, unknown>;
          };
        };
      };
    }) => {
      schema = options.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
    },
  } as unknown as McpServer;
  const task = activityTools({} as never).find((tool) => tool.name === "create_task")!;
  registerTools(server, [task], { userId: "owner" });
  assertEquals(schema.type, "object");
  const branches = taskCreate.options.map((branch) => branch.extend({ request_key: requestKey }));
  assertEquals(
    schema.oneOf,
    branches.map((branch) => z.toJSONSchema(branch, { target: "draft-2020-12", io: "input" })),
  );
  const base = { title: "업무", request_key: crypto.randomUUID() };
  for (
    const [input, accepts] of [
      [{ ...base, kind: "once" }, true],
      [{ ...base, kind: "once", due_on: "2026-10-11" }, true],
      [{ ...base, kind: "once", timezone: "Asia/Seoul" }, false],
      [{ ...base, kind: "once", recurrence: { freq: "daily", starts_on: "2026-10-11" } }, false],
      [{ ...base, kind: "recurring" }, false],
      [
        { ...base, kind: "recurring", timezone: "Asia/Seoul", recurrence: { freq: "daily", starts_on: "2026-10-11" } },
        true,
      ],
      [{
        ...base,
        kind: "recurring",
        timezone: "Asia/Seoul",
        recurrence: { freq: "daily", starts_on: "2026-10-11" },
        due_on: "2026-10-11",
      }, false],
    ] as const
  ) {
    assertEquals(branches.filter((branch) => branch.safeParse(input).success).length, accepts ? 1 : 0);
  }
});
