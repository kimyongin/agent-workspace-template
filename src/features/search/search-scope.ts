import { searchInput } from "@contracts/search.ts";
import { activityTags } from "../activity/activity-filters.ts";

/** Saved search links retain every supported filter at the public search boundary. */
export function workspaceSearchScope(params: URLSearchParams) {
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
    status: params.get("status") ?? "active",
    principle_view: params.get("principle_view") || undefined,
    from: params.get("from") ? new Date(params.get("from")!).toISOString() : undefined,
    to: params.get("to") ? new Date(params.get("to")!).toISOString() : undefined,
  });
}
