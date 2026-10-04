// 기능별 도구가 함께 쓰는 schema 안내·응답과 오류 변환. 업무 규칙은 유스케이스에 있다.
import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { Actor } from "../../core/shared/actor.ts";
import { toErrorBody } from "../errors.ts";

type Handler = (args: Record<string, unknown>, actor: Actor) => Promise<unknown>;

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  readOnly: boolean;
  destructive?: boolean;
  handler: Handler;
}

/**
 * 도구 목록에는 contracts의 JSON Schema를 그대로 알리고, 검증은 핸들러가 contracts로 한다.
 * SDK의 자체 검증은 오류를 일반 텍스트로 돌려주므로 통과시키고 계약 오류 형식을 지킨다.
 */
function documented(schema: z.ZodType): StandardSchemaWithJSON<Record<string, unknown>> {
  const std = schema["~standard"] as unknown as StandardSchemaWithJSON["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "workspace-contracts",
      validate: (value: unknown) => ({ value: (value ?? {}) as Record<string, unknown> }),
      jsonSchema: std.jsonSchema,
    },
  } as StandardSchemaWithJSON<Record<string, unknown>>;
}

export function registerTools(server: McpServer, tools: ToolDef[], actor: Actor) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: documented(tool.input),
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive ?? false,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args ?? {}, { ...actor, source: "mcp" });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (e) {
          const { body } = toErrorBody(e);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(body) }],
            structuredContent: body,
            isError: true,
          };
        }
      },
    );
  }
}
