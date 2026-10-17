import { restoreScroll } from "../../lib/surface-dom.ts";
import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { SearchResult } from "@contracts/search.ts";
import { api } from "../../lib/api.ts";
import type { ListSnapshot } from "../collections/paged-list.ts";
import { createSearchRead, searchAnchor } from "./search-read.ts";
import { WorkspaceContext } from "../details/workspace-context.ts";
const idle: ListSnapshot<SearchResult> = {
  page: null,
  busy: false,
  error: null,
  completion: null,
  showMoreControl: false,
};
const subscribeIdle = () => () => {};

/** This visit owns accepted results, URL page acknowledgement and return focus. */
export function useSearchRead(params: URLSearchParams, retry: number) {
  const revision = useContext(WorkspaceContext)?.revision;
  const previousRevision = useRef(revision);
  const location = useLocation(), navigate = useNavigate(), latest = useRef(location);
  latest.current = location;
  const scope = new URLSearchParams(params);
  scope.delete("pages");
  scope.delete("scroll");
  scope.delete("filters");
  const key = scope.toString(), q = params.get("q") ?? "";
  const requested = Number(params.get("pages") ?? 1);
  const pages = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 1;
  const session = useMemo(() => {
    if (!q) return { read: null, invalid: false };
    try {
      return {
        read: createSearchRead(new URLSearchParams(key), (input, signal) => api("POST", "/search", input, signal)),
        invalid: false,
      };
    } catch {
      return { read: null, invalid: true };
    }
  }, [key, retry]);
  const read = session.read;
  const state = useSyncExternalStore(read?.subscribe ?? subscribeIdle, read?.snapshot ?? (() => idle));
  useEffect(() => {
    void read?.restore(pages, location.hash);
  }, [read, pages, location.hash]);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      void read?.restart();
    }
  }, [read, revision]);
  useEffect(() => () => read?.cancel(), [read]);
  useEffect(() => {
    if (state.completion?.source !== "more") return;
    const at = latest.current, next = new URLSearchParams(at.search);
    next.set("pages", String(state.completion.pages));
    void navigate({ pathname: at.pathname, search: `?${next}`, hash: at.hash }, { replace: true });
  }, [state.completion, navigate]);
  const focused = useRef("");
  useEffect(() => {
    focused.current = "";
  }, [read, location.hash, revision]);
  useEffect(() => {
    const anchor = searchAnchor(location.hash);
    if (state.busy || focused.current === location.hash || !anchor || !state.page) return;
    const target = document.getElementById(`search-${anchor.kind}-${anchor.id}`);
    if (!target) {
      document.getElementById("search-title")?.focus();
      focused.current = location.hash;
      return;
    }
    target.focus({ preventScroll: true });
    const y = Number(params.get("scroll"));
    if (params.has("scroll") && Number.isFinite(y) && y >= 0) {
      restoreScroll(target, y);
    }
    const rect = target.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) target.scrollIntoView({ block: "center" });
    focused.current = location.hash;
  }, [location.hash, state.page, state.busy]);
  return {
    result: state.page,
    busy: state.busy,
    more: read?.more,
    error: session.invalid
      ? "검색어와 필터를 확인하세요. 검색어는 1~200자입니다."
      : state.error
      ? state.page ? "다음 결과를 불러오지 못했습니다. 다시 시도하세요." : "검색하지 못했습니다. 다시 시도하세요."
      : null,
  };
}
