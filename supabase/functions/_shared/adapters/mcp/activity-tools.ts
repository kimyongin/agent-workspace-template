// MCP 도구: HTTP와 같은 유스케이스를 호출한다(ADR-0001). 입력은 contracts로 검사하고,
// 실패는 HTTP와 같은 오류 본문 {code, message, retryable, fields}를 isError 결과로 돌려준다.
import type { McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { expectedVersion, id, isoDate } from "../../contracts/common.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../contracts/record.ts";
import {
  occurrenceRange,
  recurrence,
  taskComplete,
  taskCreate,
  taskListQuery,
  taskUpdate,
  timezone,
} from "../../contracts/task.ts";
import * as activity from "../../core/activity/application.ts";
import type { Actor } from "../../core/shared/actor.ts";
import { notFound } from "../../core/shared/errors.ts";
import { parse, toErrorBody } from "../errors.ts";

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

/** MCP inputSchema는 최상위가 object여야 하므로, 종류별 생성 입력을 펼친 모양으로 알린다(검증은 taskCreate). */
const createTaskInput = z.strictObject({
  kind: z.enum(["once", "recurring"]).describe("once: 일회성, recurring: 반복(회차에 기록을 남김)"),
  title: z.string().describe("제목 1~100자"),
  summary: z.string().describe("검색에 쓰는 요약 1~300자"),
  body: z.string().optional().describe("본문(마크다운) 0~20,000자"),
  due_on: isoDate.optional().describe("once만: 기한 YYYY-MM-DD(알림 없음)"),
  recurrence: recurrence.optional().describe("recurring만: 반복 규칙"),
  timezone: timezone.optional().describe("recurring만: IANA 시간대(예: Asia/Seoul). 오늘·회차 날짜의 기준"),
  request_id: z.uuid().optional().describe("재시도 시 같은 값을 보내면 첫 결과를 돌려받는다"),
});

const withId = <T extends z.ZodObject>(schema: T) => z.strictObject({ id, ...schema.shape });
const idOnly = z.strictObject({ id });
const deleteInput = z.strictObject({ id, expected_version: expectedVersion });

type Handler = (args: Record<string, unknown>, actor: Actor) => Promise<unknown>;

/** 경로 ID와 같은 규칙: UUID가 아니면 존재 여부를 드러내지 않고 not_found(HTTP와 같음). */
function split(args: Record<string, unknown>) {
  const { id: rawId, ...rest } = args;
  if (!z.uuid().safeParse(rawId).success) throw notFound();
  return { id: rawId as string, rest };
}

const versionOnly = z.strictObject({ expected_version: expectedVersion });
const byId = (args: Record<string, unknown>) => {
  const { id, rest } = split(args);
  parse(z.strictObject({}), rest);
  return id;
};
const byIdAndVersion = (args: Record<string, unknown>) => {
  const { id, rest } = split(args);
  return { id, expected_version: parse(versionOnly, rest).expected_version };
};

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  readOnly: boolean;
  destructive?: boolean;
  handler: Handler;
}

export function activityTools(deps: activity.ActivityDeps): ToolDef[] {
  return [
    {
      name: "create_task",
      description:
        "할 일을 만든다. 일회성은 open, 반복은 active로 시작한다. 반복 할 일은 앱이 자동 실행·알림하지 않는다.",
      input: createTaskInput,
      readOnly: false,
      handler: (args, actor) => activity.createTask(deps, actor, parse(taskCreate, args)),
    },
    {
      name: "get_task",
      description: "할 일 하나를 읽는다. 결과 기록의 요약과 중단 이력을 포함한다.",
      input: idOnly,
      readOnly: true,
      handler: (args, actor) => activity.getTask(deps, actor, byId(args)),
    },
    {
      name: "list_tasks",
      description:
        "할 일 목록(updated_at 내림차순, 커서 페이지). occurrence_on을 주면 그 날짜에 회차가 있는 반복 할 일과 회차 상태를 돌려준다.",
      input: taskListQuery,
      readOnly: true,
      handler: (args, actor) => activity.listTasks(deps, actor, parse(taskListQuery, args)),
    },
    {
      name: "update_task",
      description:
        "할 일의 내용 필드를 고친다(바꿀 필드만). 완료된 할 일도 고칠 수 있다. expected_version이 다르면 conflict.",
      input: withId(taskUpdate),
      readOnly: false,
      handler: (args, actor) => {
        const { id, rest } = split(args);
        return activity.updateTask(deps, actor, id, parse(taskUpdate, rest));
      },
    },
    {
      name: "complete_task",
      description:
        "일회성 할 일을 완료하고 결과 기록을 함께 저장한다(한 트랜잭션). 실제로 수행한 결과만 기록한다. 반복 할 일은 record_occurrence를 쓴다.",
      input: withId(taskComplete),
      readOnly: false,
      handler: (args, actor) => {
        const { id, rest } = split(args);
        return activity.completeTask(deps, actor, id, parse(taskComplete, rest));
      },
    },
    {
      name: "delete_task",
      description: "할 일만 지운다. 결과·회차 기록은 남고 할 일 연결만 비워진다.",
      input: deleteInput,
      readOnly: false,
      destructive: true,
      handler: async (args, actor) => {
        const input = byIdAndVersion(args);
        await activity.deleteTask(deps, actor, input.id, input.expected_version);
        return { deleted: input.id };
      },
    },
    {
      name: "list_occurrences",
      description: "반복 할 일의 기간(최대 366일) 회차와 상태(done·due·missed·upcoming). in_rule=false는 규칙 밖 기록.",
      input: withId(occurrenceRange),
      readOnly: true,
      handler: (args, actor) => {
        const { id, rest } = split(args);
        return activity.listOccurrences(deps, actor, id, parse(occurrenceRange, rest));
      },
    },
    {
      name: "record_occurrence",
      description:
        "반복 할 일의 회차(date)에 수행 기록을 남긴다. 규칙상 회차·시작일 이후·중단 기간 밖·오늘(할 일 시간대) 이전만 가능. 한 회차에 여러 번 가능.",
      input: withId(recordCreate).extend({ date: isoDate }),
      readOnly: false,
      handler: (args, actor) => {
        const { id, rest } = split(args);
        const { date, ...input } = rest;
        const day = parse(z.object({ date: isoDate }), { date }).date;
        return activity.recordOccurrence(deps, actor, id, day, parse(recordCreate, input));
      },
    },
    {
      name: "stop_task",
      description: "반복 할 일을 중단한다(오늘부터 회차 없음). 기존 기록은 유지한다.",
      input: withId(versionOnly),
      readOnly: false,
      handler: (args, actor) => {
        const input = byIdAndVersion(args);
        return activity.stopTask(deps, actor, input.id, input.expected_version);
      },
    },
    {
      name: "resume_task",
      description: "중단한 반복 할 일을 재개한다(오늘부터 회차).",
      input: withId(versionOnly),
      readOnly: false,
      handler: (args, actor) => {
        const input = byIdAndVersion(args);
        return activity.resumeTask(deps, actor, input.id, input.expected_version);
      },
    },
    {
      name: "create_record",
      description: "할 일 없이 수행 기록을 직접 작성한다. 제목·요약은 검색에 쓰인다.",
      input: recordCreate,
      readOnly: false,
      handler: (args, actor) => activity.createRecord(deps, actor, parse(recordCreate, args)),
    },
    {
      name: "get_record",
      description: "기록 하나의 원문을 읽는다.",
      input: idOnly,
      readOnly: true,
      handler: (args, actor) => activity.getRecord(deps, actor, byId(args)),
    },
    {
      name: "list_records",
      description: "기록 목록(occurred_at 내림차순, 커서 페이지). 기간·task_id로 거른다.",
      input: recordListQuery,
      readOnly: true,
      handler: (args, actor) => activity.listRecords(deps, actor, parse(recordListQuery, args)),
    },
    {
      name: "update_record",
      description: "기록을 고친다(바꿀 필드만). expected_version이 다르면 conflict.",
      input: withId(recordUpdate),
      readOnly: false,
      handler: (args, actor) => {
        const { id, rest } = split(args);
        return activity.updateRecord(deps, actor, id, parse(recordUpdate, rest));
      },
    },
    {
      name: "delete_record",
      description:
        "기록을 지운다. 일회성 할 일의 결과였다면 할 일은 완료 상태를 유지하고 결과 연결만 비워진다. 회차 기록이면 그 회차 상태가 다시 계산된다.",
      input: deleteInput,
      readOnly: false,
      destructive: true,
      handler: async (args, actor) => {
        const input = byIdAndVersion(args);
        await activity.deleteRecord(deps, actor, input.id, input.expected_version);
        return { deleted: input.id };
      },
    },
  ];
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
          const result = await tool.handler(args ?? {}, actor);
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
