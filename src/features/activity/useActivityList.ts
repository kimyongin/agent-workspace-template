import { useApi } from "../../lib/api-context.tsx";
import { useRestoreListPosition } from "../relations/ListPreviewItem.tsx";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "../../lib/workspace-router.tsx";
import type { SearchItem, SearchResult } from "@contracts/search.ts";
import type { TaskListItem } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { query } from "../../lib/api.ts";
import type { WorkspaceListKind } from "./activity-location.ts";
import type { periodBounds } from "./activity-filters.ts";
import { anchorId, requestedPages } from "./list-state.ts";
import { usePagedList } from "../collections/usePagedList.ts";
import type { ListPage } from "../collections/paged-list.ts";

export type ActivityItem = TaskListItem | RecordResult | SearchItem;
type ActivityPage = ListPage<ActivityItem> & Partial<Pick<SearchResult, "search_state" | "semantic_coverage">>;

/** The owning tab's query, accepted result and return position travel together. */
export function useActivityList(kind: WorkspaceListKind, {
  tags, bounds, layoutReady,
}: { tags: string[]; bounds: NonNullable<ReturnType<typeof periodBounds>>; layoutReady: boolean }) {
  const api = useApi();
  const [params] = useSearchParams();
  const location = useLocation(), { hash } = location;
  const latestLocation = useRef(location);
  latestLocation.current = location;
  const q = params.get("q") ?? "", entity = params.get("entity_id") || undefined;
  const filters = kind === "tasks" ? { kind: params.get("kind") || undefined, status: params.get("status") || undefined, deleted: params.get("deleted") || undefined }
    : { record_kind: params.get("record_kind") || undefined };
  const semanticSearching = !!q && !(kind === "tasks" && filters.deleted);
  const filtered = !!(q || tags.length || entity || Object.values(filters).some(Boolean) || kind === "records" && (bounds.from || bounds.to));
  const input = { query: q, kinds: [kind === "tasks" ? "task" : "record"], mode: "auto", limit: 20,
    ...(kind === "tasks" ? { task_kind: filters.kind, task_status: filters.status } : filters),
    ...(tags.length ? { tag_ids: tags } : {}), ...(entity ? { entity_id: entity } : {}), ...(kind === "records" ? bounds : {}) };
  const path = `/${kind}${query({ limit: 20, entity_id: entity, tag_ids: tags.length ? tags.join(",") : undefined,
    ...filters, ...(kind === "tasks" && filters.deleted && q ? { keyword: q } : {}), ...(kind === "records" ? { occurred_from: bounds.from, occurred_to: bounds.to } : {}) })}`;
  const scope = semanticSearching ? `${kind}|${JSON.stringify(input)}` : path;
  const errorMessage = `${kind === "tasks" ? "할 일" : "기록"}을 불러오지 못했습니다. 다시 시도하세요.`;
  const navigate = useNavigate();
  const publishPages = (count: number) => {
    const latest = latestLocation.current, next = new URLSearchParams(latest.search);
    next.set("pages", String(count));
    // A completed request preserves filters changed since it started.
    latestLocation.current = { ...latest, search: `?${next}` };
    navigate({ pathname: latest.pathname, search: `?${next}`, hash: latest.hash }, { replace: true });
  };
  const pages = requestedPages(params), anchor = anchorId(kind, hash);
  const list = usePagedList<ActivityItem, ActivityPage>({
    scope, pages, anchor, restoreRetry: "restart",
    load: (after, signal) => !semanticSearching
      ? api<ActivityPage>("GET", `${path}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`, undefined, signal)
      : api<SearchResult>("POST", "/search", { ...input, ...(after ? { cursor: after } : anchor ? {
        anchor: { kind: kind === "tasks" ? "task" : "record", id: anchor },
      } : {}) }, signal),
  });
  const { page, completion } = list;
  const items = page?.items ?? null, cursor = page?.next_cursor ?? null;
  const metadata = semanticSearching && page?.search_state && page.semantic_coverage
    ? { search_state: page.search_state, semantic_coverage: page.semantic_coverage } : null;
  useEffect(() => {
    if (completion && (completion.source === "more" ||
      completion.pages > pages && completion.anchorFound)) publishPages(completion.pages);
  }, [completion]);
  const readiness = useRestoreListPosition(kind, layoutReady&&!list.busy&&(items!==null||!!list.error));
  return { searching: !!q, semanticSearching, filtered, metadata, items, cursor, readiness,
    error: list.error ? errorMessage : null, busy: list.busy,
    showMoreControl: list.showMoreControl, more: list.more, retry: list.retry };
}
