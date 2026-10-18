import { entityReferenceId } from "./entity-identity.ts";
// 활동 기록(ActivityRecord) 계약.
import { z } from "zod";
import { changeMetadata } from "./change.ts";
import { tagFilterIds } from "./tag.ts";
import { expectedVersion, id, isoDate, isoDateTime, page, pageInput, recordBody } from "./common.ts";

/** The occurrence route owns the immutable task and date. */
export const occurrenceRecordCreate = z.strictObject({
  body: recordBody,
  occurred_at: isoDateTime.optional(),
});
export type OccurrenceRecordCreate = z.infer<typeof occurrenceRecordCreate>;

export const recordUpdate = z
  .strictObject({
    expected_version: expectedVersion,
    body: recordBody.optional(),
    occurred_at: isoDateTime.optional(),
  }).refine((value) => value.body !== undefined || value.occurred_at !== undefined, {
    message: "바꿀 필드가 없습니다",
  });
export type RecordUpdate = z.infer<typeof recordUpdate>;

export const recordListQuery = z
  .strictObject({
    occurred_from: isoDateTime.optional(),
    occurred_to: isoDateTime.optional(),
    task_id: id.optional(),
    record_kind: z.enum(["result", "change"]).optional(),
    tag_id: id.optional(),
    tag_ids: tagFilterIds.optional(),
    entity_id: entityReferenceId.optional(),
    ...pageInput,
  })
  .refine((q) => !(q.occurred_from && q.occurred_to) || Date.parse(q.occurred_from) <= Date.parse(q.occurred_to), {
    message: "occurred_from은 occurred_to보다 늦을 수 없습니다",
    path: ["occurred_from"],
  });
export type RecordListQuery = z.infer<typeof recordListQuery>;

export const recordResult = z.object({
  record_kind: z.enum(["result", "change"]),
  change: changeMetadata.nullable(),
  id,
  entity_id: entityReferenceId.nullable(),
  tag_ids: z.array(id),
  body: z.string(),
  occurred_at: isoDateTime,
  task_id: id.nullable(),
  occurrence_on: isoDate.nullable(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
}).refine((record) => (record.entity_id !== null) !== (record.task_id !== null), {
  message: "기록은 자료 하나 또는 할 일 하나에 속해야 합니다",
});
export type RecordResult = z.infer<typeof recordResult>;

export const recordPage = page(recordResult);

export const recordLabels = {
  body: "본문",
  occurred_at: "수행 시각",
  task_id: "할 일",
  occurrence_on: "회차",
} as const;
