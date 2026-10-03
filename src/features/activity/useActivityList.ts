import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { api } from "../../lib/api.ts";
import {
  type ActivityListKind,
  anchorId,
  appendItems,
  listAnchor,
  type ListPage,
  listReturnPath,
  listScope,
  type LoadedList,
  MAX_RESTORE_PAGES,
  requestedPages,
  restoreList,
} from "./list-state.ts";

export function useActivityList<T extends { id: string }>(
  kind: ActivityListKind,
  path: string,
  titleId: string,
  errorMessage: string,
) {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const scope = `${listScope(params)}|${path}`;
  const pages = requestedPages(params);
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const loaded = useRef<{ scope: string; value: LoadedList<T> } | null>(null);
  const generation = useRef(0);
  const focused = useRef("");
  const failedMore = useRef<{ scope: string; cursor: string } | null>(null);
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const load = (after?: string, signal?: AbortSignal) =>
    api<ListPage<T>>("GET", `${path}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`, undefined, signal);

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
      setItems(null);
      setCursor(null);
    }
    setError(null);
    setBusy(true);
    restoreList<T>({
      load: (after) => load(after, controller.signal),
      pages,
      anchor: anchorId(kind, hash),
      prior,
      current,
      publish: (value) => {
        loaded.current = { scope, value };
        setItems(value.items);
        setCursor(value.next_cursor);
      },
    })
      .then((value) => {
        const target = anchorId(kind, hash);
        if (current() && value && value.pages > pages && (!target || value.items.some((item) => item.id === target))) {
          const next = new URLSearchParams(params);
          next.set("pages", String(value.pages));
          navigate({ pathname: `/${kind}`, search: `?${next}`, hash }, { replace: true });
        }
      })
      .catch(() => {
        if (current()) setError(errorMessage);
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
    if (busy || items === null && !error || focused.current === hash || !anchorId(kind, hash)) return;
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
  }, [items, busy, hash, titleId, error]);

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
      setItems(value.items);
      setCursor(value.next_cursor);
      setError(null);
      const next = new URLSearchParams(params);
      next.set("pages", String(value.pages));
      navigate({ pathname: `/${kind}`, search: `?${next}`, hash }, { replace: true });
    } catch {
      if (current()) {
        failedMore.current = { scope, cursor };
        setError(errorMessage);
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  const open = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const back = listReturnPath(kind, params, id, window.scrollY);
    navigate(back, { replace: true });
    navigate(`/${kind}/${id}?list=${encodeURIComponent(back)}`);
  };
  return {
    items,
    cursor,
    error,
    busy,
    more,
    retry: () => {
      if (failedMore.current?.scope === scope && failedMore.current.cursor === cursor) {
        void more();
        return;
      }
      loaded.current = null;
      focused.current = "";
      setRetry((n) => n + 1);
    },
    link: (id: string) => ({
      id: listAnchor(kind, id),
      to: `/${kind}/${id}?list=${encodeURIComponent(listReturnPath(kind, params, id, 0))}`,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => open(event, id),
    }),
  };
}
