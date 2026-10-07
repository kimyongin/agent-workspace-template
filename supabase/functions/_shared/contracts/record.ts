import { entityContext, entitySelection } from "./entity-links.ts";
// 활동 기록(ActivityRecord) 계약.
import { z } from "zod";
import { changeMetadata } from "./change.ts";
import { tagFilterIds, tagIds } from "./tag.ts";
import { expectedVersion, id, isoDate, isoDateTime, page, pageInput, recordBody } from "./common.ts";

/** 직접 작성과 반복 할 일의 회차 기록이 같은 입력을 쓴다. */
export const recordCreate = z.strictObject({
  id,
  ...entitySelection,
  tag_ids: tagIds.optional(),
  body: recordBody,
  occurred_at: isoDateTime.optional(),
  task_id: id.optional(),
});
export type RecordCreate = z.infer<typeof recordCreate>;
/** The occurrence route owns the task and date; content cannot override them. */
export const occurrenceRecordCreate = recordCreate.omit({ task_id: true });

export const recordUpdate = z
  .strictObject({
    expected_version: expectedVersion,
    ...entitySelection,
    tag_ids: tagIds.optional(),
    body: recordBody.optional(),
    occurred_at: isoDateTime.optional(),
  }); // Automatic change records allow editing their body.
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

export const appliedPrincipleSnapshot = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  version: z.number().int(),
  saved_at: isoDateTime,
  status: z.enum(["active", "inactive"]),
  captured_at: z.enum(["application", "migration"]),
});
export type AppliedPrincipleSnapshot = z.infer<typeof appliedPrincipleSnapshot>;
export const recordResult = z.object({
  record_kind: z.enum(["user", "result", "change"]),
  change: changeMetadata.nullable(),
  applied_principle_snapshots: z.array(appliedPrincipleSnapshot),
  id,
  entity_ids: z.array(id),
  entity_context: z.array(entityContext),
  tag_ids: z.array(id),
  body: z.string(),
  occurred_at: isoDateTime,
  task_id: id.nullable(),
  occurrence_on: isoDate.nullable(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type RecordResult = z.infer<typeof recordResult>;

export const recordPage = page(recordResult);

export const recordLabels = {
  body: "본문",
  occurred_at: "수행 시각",
  task_id: "할 일",
  occurrence_on: "회차",
} as const;
