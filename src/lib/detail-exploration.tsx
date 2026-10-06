import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, type LinkProps, type NavigateOptions, type To } from "react-router";

type Frame = { key: string; path: string; title: string; scroll: number; focusHref: string | null };
type TrailState = { detailTrail: Frame[] };
const Snapshots = createContext<Map<string, Frame> | null>(null);
const detailPath = /^\/(entities|tasks|records|principles)\/[^/?#]+$/;

/** Recover only this owner's list context, even after crossing several detail kinds. */
export function useDetailOwnerReturn(fallback: string): string {
  const location = useLocation();
  const owner = `/${location.pathname.split("/")[1]}`;
  const paths = [location.search, ...detailTrail(location.state).reverse().map(frame => new URL(frame.path, "https://detail.invalid").search)];
  for (const search of paths) {
    const candidate = new URLSearchParams(search).get("list");
    if (!candidate?.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) continue;
    const url = new URL(candidate, "https://detail.invalid");
    if (url.origin === "https://detail.invalid" && url.pathname === owner) return `${url.pathname}${url.search}${url.hash}`;
  }
  return fallback;
}

/** Exploration metadata lives in browser history, never in domain data or rendered dialog stacks. */
export function detailTrail(state: unknown): Frame[] {
  if (!state || typeof state !== "object" || !("detailTrail" in state) || !Array.isArray(state.detailTrail)) return [];
  return state.detailTrail.filter((frame: unknown): frame is Frame => {
    if (!frame || typeof frame !== "object") return false;
    const value = frame as Frame;
    return typeof value.key === "string" && typeof value.path === "string" && !value.path.includes("\\")
      && (detailPath.test(value.path.split(/[?#]/)[0]) || value.path.startsWith("/search?"))
      && typeof value.title === "string" && Number.isFinite(value.scroll) && value.scroll >= 0
      && (value.focusHref === null || typeof value.focusHref === "string");
  });
}

export function DetailNavigationProvider({ children }: { children: ReactNode }) {
  const frames = useRef(new Map<string, Frame>());
  return <Snapshots.Provider value={frames.current}>{children}</Snapshots.Provider>;
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
export function DetailLink({ onClick, state, ...props }: Omit<LinkProps, "replace">) {
  const location = useLocation(), navigate = useNavigate(), frames = useContext(Snapshots);
  return <Link {...props} state={state} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || props.target && props.target !== "_self" || props.reloadDocument) return;
    const target = typeof props.to === "string" ? props.to : props.to.pathname ?? "";
    if (!detailPath.test(target.split(/[?#]/)[0]) || !(detailPath.test(location.pathname) || location.pathname === "/search")) return;
    const body = document.querySelector<HTMLElement>("dialog[open]:not(.modal-confirm) .modal-body");
    const frame: Frame = { key: location.key, path: `${location.pathname}${location.search}${location.hash}`,
      title: document.querySelector(".dialog-title, .page-title")?.textContent ?? "이전 화면",
      scroll: body?.scrollTop ?? window.scrollY, focusHref: event.currentTarget.getAttribute("href") };
    frames?.set(frame.key, frame);
    const next: TrailState = { ...(state && typeof state === "object" ? state : {}), detailTrail: [...detailTrail(location.state), frame].slice(-64) };
    event.preventDefault();
    void navigate(props.to, { state: next });
  }} />;
}

/** Only a known in-app predecessor enables Back; direct entry never guesses browser history. */
export function useDetailExploration() {
  const location = useLocation(), navigate = useNavigate(), frames = useContext(Snapshots);
  const trail = detailTrail(location.state), previous = trail.at(-1);
  useEffect(() => { for (const frame of trail) if (!frames?.has(frame.key)) frames?.set(frame.key, frame); }, [location.key, frames]);
  useEffect(() => {
    const frame = frames?.get(location.key);
    if (!frame) return;
    let done = false;
    const restore = () => {
      const body = document.querySelector<HTMLElement>("dialog[open]:not(.modal-confirm) .modal-body");
      const scope = body ?? document;
      const target = [...scope.querySelectorAll<HTMLAnchorElement>("a[href]")].find(link => link.getAttribute("href")?.split(/[?#]/)[0] === frame.focusHref?.split(/[?#]/)[0]);
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
