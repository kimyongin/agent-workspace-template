// 활동 기록(ActivityRecord) 계약. 정본: docs/tickets/template-02-t02-1-contracts.md "활동 기록".
import { z } from "zod";
import { principleResult } from "./principle.ts";
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

/** 직접 작성과 반복 할 일의 회차 기록이 같은 입력을 쓴다. */
export const recordCreate = z.strictObject({
  title,
  summary,
  body: body.default(""),
  occurred_at: isoDateTime.optional(),
  applied_principle_ids: referenceIds.default([]),
  request_id: requestId.optional(),
});
export type RecordCreate = z.infer<typeof recordCreate>;

export const recordUpdate = z
  .strictObject({
    expected_version: expectedVersion,
    title: title.optional(),
    summary: summary.optional(),
    body: body.optional(),
    occurred_at: isoDateTime.optional(),
    applied_principle_ids: referenceIds.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expected_version"), { message: "바꿀 필드가 없습니다" });
export type RecordUpdate = z.infer<typeof recordUpdate>;

export const recordListQuery = z
  .strictObject({
    occurred_from: isoDateTime.optional(),
    occurred_to: isoDateTime.optional(),
    task_id: id.optional(),
    ...pageInput,
  })
  .refine((q) => !(q.occurred_from && q.occurred_to) || Date.parse(q.occurred_from) <= Date.parse(q.occurred_to), {
    message: "occurred_from은 occurred_to보다 늦을 수 없습니다",
    path: ["occurred_from"],
  });
export type RecordListQuery = z.infer<typeof recordListQuery>;

export const recordResult = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  occurred_at: isoDateTime,
  task_id: id.nullable(),
  occurrence_on: isoDate.nullable(),
  applied_principle_ids: z.array(id),
  applied_principles: z.array(
    principleResult.pick({ id: true, title: true, status: true, updated_at: true, version: true }),
  ),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type RecordResult = z.infer<typeof recordResult>;

export const recordPage = page(recordResult);

export const recordLabels = {
  title: "제목",
  summary: "요약",
  body: "본문",
  occurred_at: "수행 시각",
  task_id: "할 일",
  occurrence_on: "회차",
  applied_principle_ids: "적용한 원칙",
} as const;
