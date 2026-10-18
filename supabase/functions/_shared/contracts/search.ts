import { entityReferenceId } from "./entity-identity.ts";
import { z } from "zod";
import { id, isoDateTime, pageInput, text } from "./common.ts";
import { tagFilterIds } from "./tag.ts";
export const searchKind = z.enum(["task", "record", "entity"]);
export const searchInput = z.strictObject({
  task_kind: z.enum(["once", "recurring"]).optional(),
  task_status: z.enum(["open", "done", "active", "stopped"]).optional(),
  record_kind: z.enum(["result", "change"]).optional(),
  query: text(1, 200),
  kinds: z.array(searchKind).min(1).max(3).refine((v) => new Set(v).size === v.length).default([
    "entity",
    "task",
    "record",
  ]),
  tag_id: id.optional(),
  tag_ids: tagFilterIds.optional(),
  entity_id: entityReferenceId.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  mode: z.enum(["auto", "keyword"]).default("auto"),
  anchor: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("task"), id }),
    z.strictObject({ kind: z.literal("record"), id }),
    z.strictObject({ kind: z.literal("entity"), id: entityReferenceId }),
  ]).optional(),
  ...pageInput,
}).refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), {
  path: ["to"],
  message: "기간의 끝은 시작 이후여야 합니다",
});
export type SearchInput = z.infer<typeof searchInput>;
export const searchItem = z.object({
  kind: searchKind,
  id: z.union([id, entityReferenceId]),
  title: z.string(),
  snippet: z.string(),
  /** Unicode code point offsets into record/task body or canonical labeled entity text, end exclusive. */
  snippet_start: z.number().int().min(0),
  snippet_end: z.number().int().min(0),
  source_fields: z.array(z.strictObject({
    key: z.string(),
    label: z.string(),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })).optional(),
  at: isoDateTime,
  tag_ids: z.array(id),
  match: z.enum(["keyword", "semantic", "both"]),
  index_state: z.enum(["indexed", "pending", "excluded", "failed"]),
  path: z.string(),
  task_status: z.enum(["open", "done", "active", "stopped"]).nullable().optional(),
  record_kind: z.enum(["result", "change"]).nullable().optional(),
});
export type SearchItem = z.infer<typeof searchItem>;
export const searchResult = z.object({
  anchor_page: z.number().int().min(1).nullable(),
  items: z.array(searchItem),
  next_cursor: z.string().nullable(),
  search_state: z.enum(["ok", "keyword_fallback"]),
  semantic_coverage: z.object({
    pending: z.number().int().min(0),
    excluded: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
});
export type SearchResult = z.infer<typeof searchResult>;
