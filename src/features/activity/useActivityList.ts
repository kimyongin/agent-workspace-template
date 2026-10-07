import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import type { SearchItem, SearchResult } from "@contracts/search.ts";
import type { TaskListItem } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { api, query } from "../../lib/api.ts";
import type { WorkspaceListKind } from "./activity-location.ts";
import type { periodBounds } from "./activity-filters.ts";
import {
  anchorId,
  appendItems,
  type ListPage,
  type LoadedList,
  MAX_RESTORE_PAGES,
  requestedPages,
  restoreList,
} from "./list-state.ts";

export type ActivityItem = TaskListItem | RecordResult | SearchItem;
type ActivityPage = ListPage<ActivityItem> & Partial<Pick<SearchResult, "search_state" | "semantic_coverage">>;

/** The owning tab's query, accepted result and return position travel together. */
export function useActivityList(kind: WorkspaceListKind, {
  tags, bounds, layoutReady,
}: { tags: string[]; bounds: NonNullable<ReturnType<typeof periodBounds>>; layoutReady: boolean }) {
  const [params] = useSearchParams();
  const location = useLocation(), { hash } = location;
  const latestLocation = useRef(location);
  latestLocation.current = location;
  const q = params.get("q") ?? "", entity = params.get("entity_id") || undefined;
  const filters = kind === "tasks" ? { kind: params.get("kind") || undefined, status: params.get("status") || undefined }
    : { record_kind: params.get("record_kind") || undefined };
  const filtered = !!(q || tags.length || entity || Object.values(filters).some(Boolean) || kind === "records" && (bounds.from || bounds.to));
  const input = { query: q, kinds: [kind === "tasks" ? "task" : "record"], mode: "auto", limit: 20,
    ...(kind === "tasks" ? { task_kind: filters.kind, task_status: filters.status } : filters),
    ...(tags.length ? { tag_ids: tags } : {}), ...(entity ? { entity_id: entity } : {}), ...(kind === "records" ? bounds : {}) };
  const path = `/${kind}${query({ limit: 20, entity_id: entity, tag_ids: tags.length ? tags.join(",") : undefined,
    ...filters, ...(kind === "records" ? { occurred_from: bounds.from, occurred_to: bounds.to } : {}) })}`;
  const scope = q ? `${kind}|${JSON.stringify(input)}` : path;
  const titleId = `${kind}-title`;
  const errorMessage = `${kind === "tasks" ? "할 일" : "기록"}을 불러오지 못했습니다. 다시 시도하세요.`;
  const navigate = useNavigate();
  const publishPages = (count: number) => {
    const latest = latestLocation.current, next = new URLSearchParams(latest.search);
    next.set("pages", String(count));
    // A completed request preserves filters changed since it started.
    latestLocation.current = { ...latest, search: `?${next}` };
    navigate({ pathname: latest.pathname, search: `?${next}`, hash: latest.hash }, { replace: true });
  };
  const pages = requestedPages(params);
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const loaded = useRef<{ scope: string; value: LoadedList<ActivityItem> } | null>(null);
  const generation = useRef(0);
  const focused = useRef("");
  const failedMore = useRef<{ scope: string; cursor: string } | null>(null);
  const [accepted, setAccepted] = useState<{ scope: string; page: ActivityPage } | null>(null);
  const visible = accepted?.scope === scope ? accepted.page : null;
  const items = visible?.items ?? null, cursor = visible?.next_cursor ?? null;
  const metadata = q && visible?.search_state && visible.semantic_coverage ? {
    search_state: visible.search_state, semantic_coverage: visible.semantic_coverage,
  } : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlScope, setControlScope] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const load = (after?: string, signal?: AbortSignal): Promise<ActivityPage> => {
    if (!q) return api<ActivityPage>("GET", `${path}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`, undefined, signal);
    const anchor = anchorId(kind, hash);
    return api<SearchResult>("POST", "/search", { ...input, ...(after ? { cursor: after } : anchor ? {
      anchor: { kind: kind === "tasks" ? "task" : "record", id: anchor },
    } : {}) }, signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    failedMore.current = null;
    const started = ++generation.current;
    const current = () => !controller.signal.aborted && generation.current === started && scopeNow.current === scope;
    const prior = loaded.current?.scope === scope && Math.min(loaded.current.value.pages, MAX_RESTORE_PAGES) <= pages
      ? loaded.current.value
      : undefined;
    if (!prior) {
      loaded.current = null;
      setAccepted(null);
    }
    setError(null);
    setBusy(true);
    restoreList<ActivityItem>({
      load: (after) => load(after, controller.signal),
      pages,
      anchor: anchorId(kind, hash),
      prior,
      current,
      publish: (value) => {
        loaded.current = { scope, value };
        setAccepted({ scope, page: value });
        if (value.next_cursor) setControlScope(scope);
      },
    })
      .then((value) => {
        // A fresh completed restoration has no paging action; manual append
        // keeps its existing control so the user's button focus survives.
        if (current() && value && !prior && !value.next_cursor) setControlScope(null);
        const target = anchorId(kind, hash);
        if (current() && value && value.pages > pages && (!target || value.items.some((item) => item.id === target))) {
          publishPages(value.pages);
        }
      })
      .catch(() => {
        if (current()) {
          setControlScope(scope);
          setError(errorMessage);
        }
      })
      .finally(() => {
        if (current()) setBusy(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [scope, pages, hash, retry]);

  useEffect(() => {
    if (!layoutReady || busy || items === null && !error || focused.current === hash || !anchorId(kind, hash)) return;
    const target = document.getElementById(hash.slice(1));
    const focus = target ?? document.getElementById(titleId);
    focus?.focus({ preventScroll: true });
    const y = Number(params.get("scroll"));
    if (params.has("scroll") && Number.isFinite(y) && y >= 0) window.scrollTo(0, y);
    if (focus) {
      const rect = focus.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) focus.scrollIntoView({ block: "center" });
    }
    focused.current = hash;
  }, [items, busy, hash, titleId, error, layoutReady]);

  const more = async () => {
    if (!cursor || busy) return;
    const started = generation.current;
    const current = () => started === generation.current && scopeNow.current === scope;
    setBusy(true);
    try {
      const page = await load(cursor);
      if (!current()) return;
      if (page.next_cursor === cursor) throw new Error("Repeated list cursor");
      const value = {
        ...page,
        items: appendItems(items ?? [], page.items),
        pages: (loaded.current?.value.pages ?? 1) + 1,
      };
      loaded.current = { scope, value };
      failedMore.current = null;
      setAccepted({ scope, page: value });
      setError(null);
      publishPages(value.pages);
    } catch {
      if (current()) {
        failedMore.current = { scope, cursor };
        setError(errorMessage);
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  return {
    searching: !!q,
    filtered,
    metadata,
    items,
    cursor,
    error,
    busy,
    showMoreControl: controlScope === scope,
    more,
    retry: () => {
      if (busy) return;
      if (failedMore.current?.scope === scope && failedMore.current.cursor === cursor) {
        void more();
        return;
      }
      loaded.current = null;
      focused.current = "";
      setRetry((n) => n + 1);
    },
  };
}
