import { searchInput } from "@contracts/search.ts";
import { activityTags } from "../activity/activity-filters.ts";

/** Saved search links retain every supported filter at the public search boundary. */
export function workspaceSearchScope(params: URLSearchParams) {
  if (params.has("status") || params.has("principle_view")) {
    throw new Error("지원하지 않는 검색 조건입니다. 자료·할 일·기록을 검색하세요.");
  }
  const tags = activityTags(params);
  return searchInput.parse({
    query: params.get("q") ?? "",
    ...(params.get("kind") ? { kinds: [params.get("kind")] } : {}),
    ...(tags.length ? { tag_ids: tags } : {}),
    entity_id: params.get("entity_id") || undefined,
    record_kind: params.get("record_kind") || undefined,
    task_kind: params.get("task_kind") || undefined,
    task_status: params.get("task_status") || undefined,
    mode: params.get("mode") ?? "auto",
    from: params.get("from") ? new Date(params.get("from")!).toISOString() : undefined,
    to: params.get("to") ? new Date(params.get("to")!).toISOString() : undefined,
  });
}
