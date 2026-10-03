// 할 일(Task)·반복 할 일 계약. 정본: docs/tickets/template-02-t02-1-contracts.md "할 일", "반복 할 일".
// HTTP 입력 검증·MCP inputSchema·웹 폼이 이 정의를 함께 쓴다. zod만 가져온다.
import { z } from "zod";
import {
  body,
  expectedVersion,
  id,
  isoDate,
  isoDateTime,
  page,
  pageInput,
  referenceIds,
  requestId,
  summary,
  title,
} from "./common.ts";
import { recordResult } from "./record.ts";

export const TASK_KINDS = ["once", "recurring"] as const;
export const TASK_STATUSES = ["open", "done", "active", "stopped"] as const;
export const OCCURRENCE_STATUSES = ["done", "due", "missed", "upcoming"] as const;
export const MAX_OCCURRENCE_RANGE_DAYS = 366;

/** IANA 시간대 이름(예: Asia/Seoul). 런타임의 Intl이 아는 이름만 받는다. */
export const timezone = z.string().min(1).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, { message: "알 수 없는 시간대입니다" });

const uniqueSorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

export const recurrence = z.discriminatedUnion("freq", [
  z.strictObject({ freq: z.literal("daily"), starts_on: isoDate }),
  z.strictObject({
    freq: z.literal("weekly"),
    /** ISO 요일: 1=월 … 7=일 */
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, { message: "요일을 하나 이상 고르세요" }).max(7)
      .transform(uniqueSorted),
    starts_on: isoDate,
  }),
  z.strictObject({
    freq: z.literal("monthly"),
    /** 그 달에 없는 날짜는 그 달의 마지막 날 회차로 계산한다. */
    month_days: z.array(
      z.number().int().min(1, { message: "1~31 사이 날짜를 쓰세요" }).max(31, { message: "1~31 사이 날짜를 쓰세요" }),
    )
      .min(1, { message: "날짜를 하나 이상 쓰세요" }).max(31).transform(uniqueSorted),
    starts_on: isoDate,
  }),
]);
export type Recurrence = z.infer<typeof recurrence>;

export const taskCreate = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("once"),
    title,
    summary,
    body: body.default(""),
    due_on: isoDate.optional(),
    request_id: requestId.optional(),
  }),
  z.strictObject({
    kind: z.literal("recurring"),
    title,
    summary,
    body: body.default(""),
    recurrence,
    timezone,
    request_id: requestId.optional(),
  }),
]);
export type TaskCreate = z.infer<typeof taskCreate>;

/** 내용 필드만 고친다. `kind`·`status`·시각 등 서버 관리 필드는 strict로 거부된다. */
export const taskUpdate = z
  .strictObject({
    expected_version: expectedVersion,
    title: title.optional(),
    summary: summary.optional(),
    body: body.optional(),
    due_on: isoDate.nullable().optional(),
    recurrence: recurrence.optional(),
    timezone: timezone.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expected_version"), { message: "바꿀 필드가 없습니다" });
export type TaskUpdate = z.infer<typeof taskUpdate>;

export const versionOnly = z.strictObject({ expected_version: expectedVersion });

/** 일회성 할 일 완료: 결과 기록 내용과 함께 한 트랜잭션으로 저장한다. */
export const taskComplete = z.strictObject({
  applied_principle_ids: referenceIds.default([]),
  expected_version: expectedVersion,
  title,
  summary,
  body: body.default(""),
  occurred_at: isoDateTime.optional(),
  request_id: requestId.optional(),
});
export type TaskComplete = z.infer<typeof taskComplete>;

export const taskListQuery = z
  .strictObject({
    kind: z.enum(TASK_KINDS).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    due_from: isoDate.optional(),
    due_to: isoDate.optional(),
    /** 그 날짜에 회차가 있는 반복 할 일만, 회차 상태와 함께. */
    occurrence_on: isoDate.optional(),
    ...pageInput,
  })
  .refine((q) => !(q.due_from && q.due_to) || q.due_from <= q.due_to, {
    message: "due_from은 due_to보다 늦을 수 없습니다",
    path: ["due_from"],
  });
export type TaskListQuery = z.infer<typeof taskListQuery>;

export const occurrenceRange = z
  .strictObject({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: "from은 to보다 늦을 수 없습니다", path: ["from"] })
  .refine(
    (r) =>
      (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000 < MAX_OCCURRENCE_RANGE_DAYS,
    { message: `기간은 최대 ${MAX_OCCURRENCE_RANGE_DAYS}일입니다`, path: ["to"] },
  );

export const pause = z.object({ stopped_on: isoDate, resumed_on: isoDate.nullable() });

export const taskResult = z.object({
  id,
  kind: z.enum(TASK_KINDS),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  due_on: isoDate.nullable(),
  recurrence: recurrence.nullable(),
  timezone: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  completed_at: isoDateTime.nullable(),
  result_record_id: id.nullable(),
  /** 중단·재개 이력(반복 할 일). 서버가 보관한다. */
  pauses: z.array(pause),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type TaskResult = z.infer<typeof taskResult>;

export const occurrence = z.object({
  date: isoDate,
  status: z.enum(OCCURRENCE_STATUSES),
  record_ids: z.array(id),
  /** false면 현재 규칙에는 없는 날짜의 기록("규칙 밖 기록"). */
  in_rule: z.boolean(),
});
export type Occurrence = z.infer<typeof occurrence>;

/** 단건 조회: 결과 기록의 요약과 함께. 상세 경로는 웹이 `/records/:id`로 만든다. */
export const taskDetail = taskResult.extend({
  result_record: z.object({ id, title: z.string(), summary: z.string() }).nullable(),
});
export type TaskDetail = z.infer<typeof taskDetail>;

export const taskListItem = taskResult.extend({ occurrence: occurrence.nullable() });
export type TaskListItem = z.infer<typeof taskListItem>;
export const taskPage = page(taskListItem);

export const completeResult = z.object({ task: taskResult, record: recordResult });
export const occurrenceList = z.object({
  task_id: id,
  from: isoDate,
  to: isoDate,
  today: isoDate,
  items: z.array(occurrence),
});

export const taskLabels = {
  kind: "종류",
  once: "일회성",
  recurring: "반복",
  title: "제목",
  summary: "요약",
  body: "본문",
  due_on: "기한",
  recurrence: "반복 규칙",
  timezone: "시간대",
  status: "상태",
  open: "진행 중",
  done: "완료",
  active: "반복 중",
  stopped: "중단됨",
  daily: "매일",
  weekly: "매주",
  monthly: "매월",
  weekdays: "요일",
  month_days: "날짜",
  starts_on: "시작일",
  occurrence: {
    done: "기록함",
    due: "오늘 할 차례",
    missed: "하지 않음",
    upcoming: "예정",
  },
} as const;
