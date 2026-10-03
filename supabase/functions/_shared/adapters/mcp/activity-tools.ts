// MCP 도구: HTTP와 같은 유스케이스를 호출한다(ADR-0001). 입력은 contracts로 검사하고,
// 실패는 HTTP와 같은 오류 본문 {code, message, retryable, fields}를 isError 결과로 돌려준다.
import type { ToolDef } from "./tools.ts";
import { z } from "zod";
import { expectedVersion, id, isoDate } from "../../contracts/common.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../contracts/record.ts";
import { occurrenceRange, taskComplete, taskCreate, taskListQuery, taskUpdate } from "../../contracts/task.ts";
import * as activity from "../../core/activity/application.ts";
import { notFound } from "../../core/shared/errors.ts";
import { parse } from "../errors.ts";

/** MCP inputSchema는 최상위가 object여야 하므로, 종류별 생성 입력을 펼친 모양으로 알린다(검증은 taskCreate). */
const createTaskShape: Record<string, z.ZodType> = Object.assign({}, ...taskCreate.options.map((s) => s.shape));
for (const [key, schema] of Object.entries(createTaskShape)) {
  if (!taskCreate.options.every((s) => key in s.shape)) createTaskShape[key] = schema.optional();
}
const createTaskInput = z.strictObject({
  ...createTaskShape,
  kind: z.enum(["once", "recurring"]).describe("once: 일회성, recurring: 반복(회차에 기록을 남김)"),
});

const withId = <T extends z.ZodObject>(schema: T) => z.strictObject({ id, ...schema.shape });
const idOnly = z.strictObject({ id });
const deleteInput = z.strictObject({ id, expected_version: expectedVersion });

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

export function activityTools(deps: activity.ActivityDeps): ToolDef[] {
  return [
    {
      name: "create_task",
      description:
        "할 일을 만든다. 일회성은 open, 반복은 active. tag_ids는 내 태그 ID 최대 10개. 반복 할 일은 앱이 자동 실행·알림하지 않는다.",
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
        "할 일 목록(updated_at 내림차순, 커서 페이지). tag_id로 필터한다. occurrence_on은 해당 회차가 있는 반복 할 일과 회차 상태를 돌려준다.",
      input: taskListQuery,
      readOnly: true,
      handler: (args, actor) => activity.listTasks(deps, actor, parse(taskListQuery, args)),
    },
    {
      name: "update_task",
      description:
        "할 일의 내용 필드를 고친다. tag_ids 생략은 유지, 빈 배열은 제거. 완료된 할 일도 고칠 수 있다. expected_version이 다르면 conflict.",
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
        "일회성 할 일을 완료하고 결과 기록·applied_principle_ids를 함께 저장한다(한 트랜잭션). 실제로 수행한 결과만 기록한다. 반복 할 일은 record_occurrence를 쓴다.",
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
        "반복 할 일의 회차(date)에 수행 기록·applied_principle_ids를 남긴다. 규칙상 회차·시작일 이후·중단 기간 밖·오늘(할 일 시간대) 이전만 가능. 한 회차에 여러 번 가능.",
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
      description:
        "할 일 없이 수행 기록을 직접 작성한다. 제목·요약은 검색에 쓰인다. applied_principle_ids는 실제 적용한 원칙 ID(최대 100개).",
      input: recordCreate,
      readOnly: false,
      handler: (args, actor) => activity.createRecord(deps, actor, parse(recordCreate, args)),
    },
    {
      name: "get_record",
      description:
        "기록 원문과 적용 원칙을 읽는다. applied_principles는 현재 제목·상태·버전·수정 시각이며 당시 사본이 아니다.",
      input: idOnly,
      readOnly: true,
      handler: (args, actor) => activity.getRecord(deps, actor, byId(args)),
    },
    {
      name: "list_records",
      description: "기록 목록(occurred_at 내림차순, 커서 페이지). 기간·task_id·tag_id로 거른다.",
      input: recordListQuery,
      readOnly: true,
      handler: (args, actor) => activity.listRecords(deps, actor, parse(recordListQuery, args)),
    },
    {
      name: "update_record",
      description:
        "기록을 고친다. tag_ids·applied_principle_ids 생략은 유지, 빈 배열은 연결 제거. expected_version이 다르면 conflict.",
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
