import { consistentEntities, entityContext, entitySelection, entitySelectionError } from "./entity-links.ts";
// 활동 기록(ActivityRecord) 계약.
import { z } from "zod";
import { changeMetadata, mutationMeta } from "./change.ts";
import { principleResult } from "./principle.ts";
import { tagFilterIds, tagIds } from "./tag.ts";
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
  ...mutationMeta,
  ...entitySelection,
  tag_ids: tagIds.optional(),
  title,
  summary,
  body: body.default(""),
  occurred_at: isoDateTime.optional(),
  applied_principle_ids: referenceIds.default([]),
  request_id: requestId.optional(),
}).refine(consistentEntities, entitySelectionError);
export type RecordCreate = z.infer<typeof recordCreate>;

export const recordUpdate = z
  .strictObject({
    ...mutationMeta,
    expected_version: expectedVersion,
    ...entitySelection,
    tag_ids: tagIds.optional(),
    title: title.optional(),
    summary: summary.optional(),
    body: body.optional(),
    occurred_at: isoDateTime.optional(),
    applied_principle_ids: referenceIds.optional(),
  }).refine(consistentEntities, entitySelectionError); // Automatic change records also allow editing only their note.
export type RecordUpdate = z.infer<typeof recordUpdate>;

export const recordListQuery = z
  .strictObject({
    occurred_from: isoDateTime.optional(),
    occurred_to: isoDateTime.optional(),
    task_id: id.optional(),
    record_kind: z.enum(["user", "result", "change"]).optional(),
    tag_id: id.optional(),
    tag_ids: tagFilterIds.optional(),
    entity_id: id.optional(),
    ...pageInput,
  })
  .refine((q) => !(q.occurred_from && q.occurred_to) || Date.parse(q.occurred_from) <= Date.parse(q.occurred_to), {
    message: "occurred_from은 occurred_to보다 늦을 수 없습니다",
    path: ["occurred_from"],
  });
export type RecordListQuery = z.infer<typeof recordListQuery>;

export const appliedPrincipleSnapshot = principleResult.pick({
  id: true,
  title: true,
  summary: true,
  body: true,
  version: true,
  saved_at: true,
  status: true,
}).extend({ captured_at: z.enum(["application", "migration"]) });
export type AppliedPrincipleSnapshot = z.infer<typeof appliedPrincipleSnapshot>;
export const recordResult = z.object({
  record_kind: z.enum(["user", "result", "change"]),
  change_note: z.string().nullable(),
  change: changeMetadata.nullable(),
  applied_principle_snapshots: z.array(appliedPrincipleSnapshot),
  id,
  entity_id: id.nullable(),
  entity_ids: z.array(id),
  entity_context: z.array(entityContext),
  tag_ids: z.array(id),
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
