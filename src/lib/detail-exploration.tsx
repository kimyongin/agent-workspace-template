import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, type LinkProps, type NavigateOptions, type To } from "react-router";

type Frame = { key: string; path: string; title: string; scroll: number; focusKey: string };
type TrailState = { detailScope: string; detailTrail: Frame[] };
const Snapshots = createContext<{scope: string; frames: Map<string, Frame>} | null>(null);
const detailPath = /^\/(entities|tasks|records|principles)\/[^/?#]+$/;

/** Recover only this owner's list context, even after crossing several detail kinds. */
export function useDetailOwnerReturn(fallback: string): string {
  const location = useLocation();
  const context = useContext(Snapshots);
  const owner = `/${location.pathname.split("/")[1]}`;
  const paths = [location.search, ...detailTrail(location.state, context?.scope).reverse().map(frame => new URL(frame.path, "https://detail.invalid").search)];
  for (const search of paths) {
    const candidate = new URLSearchParams(search).get("list");
    if (!candidate?.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) continue;
    const url = new URL(candidate, "https://detail.invalid");
    if (url.origin === "https://detail.invalid" && url.pathname === owner) return `${url.pathname}${url.search}${url.hash}`;
  }
  return fallback;
}

/** Exploration metadata lives in browser history, never in domain data or rendered dialog stacks. */
function detailTrail(state: unknown, scope: string | undefined): Frame[] {
  if (!scope || !state || typeof state !== "object" || !("detailScope" in state) || state.detailScope !== scope
    || !("detailTrail" in state) || !Array.isArray(state.detailTrail)) return [];
  return state.detailTrail.filter((frame: unknown): frame is Frame => {
    if (!frame || typeof frame !== "object") return false;
    const value = frame as Frame;
    return typeof value.key === "string" && typeof value.path === "string" && !value.path.includes("\\")
      && (detailPath.test(value.path.split(/[?#]/)[0]) || value.path.startsWith("/search?"))
      && typeof value.title === "string" && Number.isFinite(value.scroll) && value.scroll >= 0
      && typeof value.focusKey === "string";
  });
}

export function DetailNavigationProvider({ children, scope = "app" }: { children: ReactNode; scope?: string }) {
  const context = useRef({ scope, frames: new Map<string, Frame>() });
  if (context.current.scope !== scope) context.current = {scope, frames: new Map<string, Frame>()};
  return <Snapshots.Provider value={context.current}>{children}</Snapshots.Provider>;
}

/** Same-detail mode changes replace the entry and retain its exploration context. Exits clear it. */
export function useDetailNavigate() {
  const location = useLocation(), navigate = useNavigate();
  return useCallback((to: To, options: NavigateOptions = {}) => {
    const destination = typeof to === "string" ? to : to.pathname ?? location.pathname;
    const sameDetail = detailPath.test(location.pathname) && (destination.startsWith("?") || destination.split(/[?#]/)[0] === location.pathname);
    const exit = detailPath.test(location.pathname) && !sameDetail;
    return navigate(to, { ...options, ...(sameDetail ? { replace: true, state: location.state } : exit ? { replace: true, state: null } : {}) });
  }, [location.pathname, location.state, navigate]);
}

/** Use for every link to a detail, including related items and search results. */
export function DetailLink({ onClick, state, restoreKey, ...props }: Omit<LinkProps, "replace"> & {restoreKey?: string}) {
  const location = useLocation(), navigate = useNavigate(), context = useContext(Snapshots);
  const target = typeof props.to === "string" ? props.to : props.to.pathname ?? "";
  return <Link {...props} data-detail-focus={restoreKey ?? props.id ?? target} state={state} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || props.target && props.target !== "_self" || props.reloadDocument) return;
    if (!detailPath.test(target.split(/[?#]/)[0]) || !(detailPath.test(location.pathname) || location.pathname === "/search")) return;
    const body = document.querySelector<HTMLElement>("dialog[open]:not(.modal-confirm) .modal-body");
    const frame: Frame = { key: location.key, path: `${location.pathname}${location.search}${location.hash}`,
      title: document.querySelector(".dialog-title, .page-title")?.textContent ?? "이전 화면",
      scroll: body?.scrollTop ?? window.scrollY, focusKey: event.currentTarget.dataset.detailFocus ?? target };
    context?.frames.set(frame.key, frame);
    const next: TrailState = { ...(state && typeof state === "object" ? state : {}), detailScope: context?.scope ?? "",
      detailTrail: [...detailTrail(location.state, context?.scope), frame].slice(-64) };
    event.preventDefault();
    void navigate(props.to, { state: next });
  }} />;
}

/** Only a known in-app predecessor enables Back; direct entry never guesses browser history. */
export function useDetailExploration() {
  const location = useLocation(), navigate = useNavigate(), context = useContext(Snapshots);
  const frames = context?.frames;
  const trail = detailTrail(location.state, context?.scope), previous = trail.at(-1);
  useEffect(() => { for (const frame of trail) if (!frames?.has(frame.key)) frames?.set(frame.key, frame); }, [location.key, frames]);
  useEffect(() => {
    const frame = frames?.get(location.key);
    if (!frame) return;
    let done = false;
    const restore = () => {
      const body = document.querySelector<HTMLElement>("dialog[open]:not(.modal-confirm) .modal-body");
      const scope = body ?? document;
      const target = [...scope.querySelectorAll<HTMLAnchorElement>("a[data-detail-focus]")].find(link => link.dataset.detailFocus === frame.focusKey);
      const loading = scope.querySelector('p.secondary[role="status"]');
      if (done || loading || !target && !scope.querySelector(".detail-section, .list, [role=alert]")) return;
      done = true;
      (target ?? document.querySelector<HTMLElement>(".dialog-title, .page-title"))?.focus({ preventScroll: true });
      if (body) body.scrollTop = frame.scroll; else window.scrollTo(0, frame.scroll);
    };
    let animation = 0;
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(restore); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => { cancelAnimationFrame(animation); observer.disconnect(); };
  }, [location.key, frames]);
  return previous ? { label: `이전: ${previous.title}`, back: () => { void navigate(-1); } } : null;
}
