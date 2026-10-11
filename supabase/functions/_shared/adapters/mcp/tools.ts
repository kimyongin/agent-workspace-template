// 기능별 도구가 함께 쓰는 schema 안내·응답과 오류 변환. 업무 규칙은 유스케이스에 있다.
import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Actor } from "../../core/shared/actor.ts";
import { requestKey } from "../../contracts/request.ts";
import { parse } from "../errors.ts";
import { toErrorBody } from "../errors.ts";

type Handler = (args: Record<string, unknown>, actor: Actor) => Promise<unknown>;

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  inputVariants?: z.ZodObject[];
  readOnly: boolean;
  destructive?: boolean;
  handler: Handler;
}

/**
 * 도구 목록에는 contracts의 JSON Schema를 그대로 알리고, 검증은 핸들러가 contracts로 한다.
 * SDK의 자체 검증은 오류를 일반 텍스트로 돌려주므로 통과시키고 계약 오류 형식을 지킨다.
 */
function documented(schema: z.ZodType, variants?: z.ZodObject[]): StandardSchemaWithJSON<Record<string, unknown>> {
  const std = schema["~standard"] as unknown as StandardSchemaWithJSON["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "workspace-contracts",
      validate: (value: unknown) => ({ value: (value ?? {}) as Record<string, unknown> }),
      jsonSchema: variants
        ? {
          ...std.jsonSchema,
          input: (options) => ({
            ...std.jsonSchema.input(options),
            oneOf: variants.map((variant) => variant["~standard"].jsonSchema.input(options)),
          }),
        }
        : std.jsonSchema,
    },
  } as StandardSchemaWithJSON<Record<string, unknown>>;
}

export function registerTools(server: McpServer, tools: ToolDef[], actor: Actor) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: documented(tool.input, tool.inputVariants),
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

/** Explicit logical key is transport metadata and never reaches business payload schemas. */
export function keyedTool(tool: ToolDef): ToolDef {
  const object = tool.input as z.ZodObject;
  return {
    ...tool,
    description:
      `${tool.description} request_key는 논리 요청의 UUID입니다. 재시도는 같은 키와 입력을 유지하며 성공 재현은 당시 결과입니다.`,
    input: z.strictObject({ ...object.shape, request_key: requestKey }),
    inputVariants: tool.inputVariants?.map((variant) => variant.extend({ request_key: requestKey })),
    handler: (args, actor) => {
      const { request_key, ...input } = args;
      const key = parse(requestKey, request_key);
      return tool.handler(input, { ...actor, request: { key } });
    },
  };
}
