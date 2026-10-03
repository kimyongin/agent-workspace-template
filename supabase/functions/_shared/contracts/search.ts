import { z } from "zod";
import { id, isoDateTime, pageInput, text } from "./common.ts";
export const searchKind = z.enum(["task", "record", "principle"]);
export const searchInput = z.strictObject({
  query: text(1, 200),
  kinds: z.array(searchKind).min(1).max(3).refine((v) => new Set(v).size === v.length).default([
    "task",
    "record",
    "principle",
  ]),
  tag_id: id.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  mode: z.enum(["auto", "keyword"]).default("auto"),
  ...pageInput,
}).refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), {
  path: ["to"],
  message: "기간의 끝은 시작 이후여야 합니다",
});
export type SearchInput = z.infer<typeof searchInput>;
export const searchItem = z.object({
  kind: searchKind,
  id,
  title: z.string(),
  summary: z.string(),
  at: isoDateTime,
  tag_ids: z.array(id),
  match: z.enum(["keyword", "semantic", "both"]),
  index_state: z.enum(["indexed", "pending", "excluded"]),
  path: z.string(),
});
export type SearchItem = z.infer<typeof searchItem>;
export const searchResult = z.object({
  items: z.array(searchItem),
  next_cursor: z.string().nullable(),
  search_state: z.enum(["ok", "keyword_fallback"]),
  semantic_coverage: z.object({ pending: z.number().int().min(0), excluded: z.number().int().min(0) }),
});
export type SearchResult = z.infer<typeof searchResult>;
