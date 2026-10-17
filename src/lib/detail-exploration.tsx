import { activeSurface, scrollOwner, scrollTop, restoreScroll } from "./surface-dom.ts";
import { detailListReturn } from "./entity-list-url.ts";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { Link, useLocation, useNavigate, type LinkProps, type NavigateOptions, type To } from "react-router";
import { DetailTabContext, WorkspaceContext, detailIdentity } from "../features/details/workspace-context.ts";

type Frame = { key: string; path: string; title: string; scroll: number; focusKey: string };
type TrailState = { detailScope: string; detailVersion:2; detailTrail: Frame[] };
type SnapshotsState = {scope:string;frames:Map<string,Frame>;views:Map<string,unknown>;transition:{key:string;path:To;state?:unknown}|null};
const Snapshots = createContext<SnapshotsState | null>(null);
const detailPath = /^\/(?:(entities|tasks|records)\/[^/?#]+|tags(?:\/(?:entity|task|record))?)$/;
const tagOrigin = /^\/(entities|tasks|records|settings)$/;

/** Recover only this owner's list context, even after crossing several detail kinds. */
export function useDetailOwnerReturn(fallback: string): string {
  const location = useLocation();
  const context = useContext(Snapshots);
  const trail=detailTrail(location.state,context?.scope);
  const entry=trail.find(frame=>!detailPath.test(frame.path.split(/[?#]/)[0]));
  if(entry)return entry.path;
  const root=trail.find(frame=>detailPath.test(frame.path.split(/[?#]/)[0]));
  const owner = `/${(root?.path??location.pathname).split("/")[1]}`;
  const paths = [...(root?[new URL(root.path,"https://detail.invalid")]:[]),new URL(location.pathname+location.search+location.hash,"https://detail.invalid")];
  for (const path of paths) {
    const candidate = detailListReturn(path, owner);
    if (candidate) return candidate;
  }
  return root?owner:fallback;
}

/** Deleting a related viewer target returns to its starting detail, not a different tab. */
export function useDetailDeleteReturn(fallback:string):string {
  const location=useLocation(),context=useContext(Snapshots);
  const root=detailTrail(location.state,context?.scope).find(frame=>detailPath.test(frame.path.split(/[?#]/)[0]));
  return root?root.path:fallback;
}

/** Exploration metadata lives in browser history, never in domain data or rendered dialog stacks. */
function detailTrail(state: unknown, scope: string | undefined): Frame[] {
  if (!scope || !state || typeof state !== "object" || !("detailScope" in state) || state.detailScope !== scope
    || !("detailVersion" in state)||state.detailVersion!==2||!("detailTrail" in state) || !Array.isArray(state.detailTrail)) return [];
  return state.detailTrail.filter((frame: unknown): frame is Frame => {
    if (!frame || typeof frame !== "object") return false;
    const value = frame as Frame;
    return typeof value.key === "string" && typeof value.path === "string" && !value.path.includes("\\")
      && (detailPath.test(value.path.split(/[?#]/)[0]) || value.path.startsWith("/search?") || tagOrigin.test(value.path.split(/[?#]/)[0]))
      && typeof value.title === "string" && Number.isFinite(value.scroll) && value.scroll >= 0
      && typeof value.focusKey === "string";
  });
}

export function DetailNavigationProvider({ children, scope = "app" }: { children: ReactNode; scope?: string }) {
  const location=useLocation(),navigate=useNavigate();
  const context = useRef<SnapshotsState>({ scope, frames: new Map(), views: new Map(),transition:null });
  if (context.current.scope !== scope) context.current = {scope, frames: new Map(), views: new Map(),transition:null};
  useEffect(()=>{
    const transition=context.current.transition;
    if(!transition||transition.key!==location.key)return;
    context.current.transition=null;
    void navigate(transition.path,{replace:true,state:transition.state??null});
  },[location.key,navigate]);
  useRestoreFrame(context.current.frames);
  return <Snapshots.Provider value={context.current}>{children}</Snapshots.Provider>;
}

/** Ephemeral view choices follow a history entry and disappear on account scope changes. */
export function useDetailViewState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(Snapshots), location = useLocation();
  const key = `${location.key}:${name}`;
  const [value, setValue] = useState<T>(() => context?.views.has(key) ? context.views.get(key) as T : initial);
  useEffect(() => { context?.views.set(key, value); }, [context, key, value]);
  return [value, setValue];
}

/** Same-detail mode changes replace the entry and retain its exploration context. Exits clear it. */
export function useDetailNavigate() {
  const location = useLocation(), navigate = useNavigate(),context=useContext(Snapshots);
  const tab = useContext(DetailTabContext);
  return useCallback((to: To, options: NavigateOptions = {}) => {
    if (tab) return tab.navigate(to, options);
    const destination = typeof to === "string" ? to : to.pathname ?? location.pathname;
    const sameDetail = detailPath.test(location.pathname) && (destination.startsWith("?") || destination.split(/[?#]/)[0] === location.pathname);
    const exit = detailPath.test(location.pathname) && !sameDetail;
    const root=detailTrail(location.state,context?.scope).find(frame=>detailPath.test(frame.path.split(/[?#]/)[0]));
    if(root&&exit){
      if(destination.split(/[?#]/)[0]===root.path.split(/[?#]/)[0])return navigate(-1);
      if(!detailPath.test(destination.split(/[?#]/)[0])&&context){
        // Replace the dismissed editor too: Forward must not revive an ended detail session.
        context.transition={key:root.key,path:to};
        return Promise.resolve(navigate(to,{replace:true,state:null})).then(()=>navigate(-1));
      }
    }
    return navigate(to, { ...options, ...(sameDetail ? { replace: true, state: location.state } : exit ? { replace: true, state: null } : {}) });
  }, [location.pathname, location.state, navigate,context,tab]);
}

/** Use for every link to a detail, including related items and search results. */
export function DetailLink({ onClick, state, restoreKey, ...props }: Omit<LinkProps, "replace"> & {restoreKey?: string}) {
  const location = useLocation(), navigate = useNavigate(), context = useContext(Snapshots);
  const workspace = useContext(WorkspaceContext);
  const owner=useDetailOwnerReturn(`/${location.pathname.split("/")[1]}`);
  const target = typeof props.to === "string" ? props.to : props.to.pathname ?? "";
  return <Link {...props} data-detail-focus={restoreKey ?? props.id ?? target} state={state} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || props.target && props.target !== "_self" || props.reloadDocument) return;
    if (workspace && detailIdentity(target)) {
      event.preventDefault();
      const source = location.pathname === "/search" && props.id ? new URLSearchParams(location.search) : null;
      const list = scrollOwner(event.currentTarget);
      source?.set("scroll", String(list?.scrollTop ?? window.scrollY));
      workspace.open(props.to, source ? {...location,search:`?${source}`,hash:`#${encodeURIComponent(props.id!)}`} : location);
      return;
    }
    if (!detailPath.test(target.split(/[?#]/)[0]) || !(detailPath.test(location.pathname) || location.pathname === "/search" || target.startsWith("/tags") && tagOrigin.test(location.pathname))) return;
    if(target.split(/[?#]/)[0]===location.pathname){event.preventDefault();void navigate(props.to,{replace:true,state:location.state});return;}
    const body = activeSurface(false)?.body ?? null;
    const searchOrigin = location.pathname === "/search" && props.id ? new URLSearchParams(location.search) : null;
    searchOrigin?.set("scroll", String(scrollTop(event.currentTarget)));
    const origin = searchOrigin ? `/search?${searchOrigin}#${props.id}` : `${location.pathname}${location.search}${location.hash}`;
    const frame: Frame = { key: location.key, path: origin,
      title: activeSurface(false)?.title ?? document.querySelector("h1")?.textContent ?? "이전 화면",
      scroll: body?.scrollTop ?? scrollTop(event.currentTarget), focusKey: event.currentTarget.dataset.detailFocus ?? target };
    context?.frames.set(frame.key, frame);
    const trail=detailTrail(location.state,context?.scope),root=trail.find(frame=>detailPath.test(frame.path.split(/[?#]/)[0]));
    const next: TrailState = { ...(state && typeof state === "object" ? state : {}), detailScope: context?.scope ?? "",detailVersion:2,
      detailTrail: root?trail:[...trail,frame] };
    event.preventDefault();
    if(root&&target.split(/[?#]/)[0]===root.path.split(/[?#]/)[0]&&context){
      context.transition={key:root.key,path:root.path,state:{detailScope:context.scope,detailVersion:2,detailTrail:trail.filter(value=>value.key!==root.key)}};
      // End the replaced child too, so Forward cannot revive it after root Close.
      void Promise.resolve(navigate(owner,{replace:true,state:null})).then(()=>navigate(-1));return;
    }
    // The search route's existing anchor replay also restores deep results after reload or concurrent additions.
    const prepare = searchOrigin ? navigate(origin, {replace: true, state: location.state}) : undefined;
    void Promise.resolve(prepare).then(() => navigate(props.to, { state: next,replace:!!root }));
  }} />;
}

/** Only a known in-app predecessor enables Back; direct entry never guesses browser history. */
export function useDetailExploration() {
  const location = useLocation(), navigate = useNavigate(), context = useContext(Snapshots);
  const frames = context?.frames;
  const trail = detailTrail(location.state, context?.scope), previous = trail.at(-1);
  useEffect(() => { for (const frame of trail) if (!frames?.has(frame.key)) frames?.set(frame.key, frame); }, [location.key, frames]);
  return previous ? { label: `이전: ${previous.title}`,back: () => { void navigate(-1); } } : null;
}

function useRestoreFrame(frames: Map<string, Frame>) {
  const location=useLocation();
  useEffect(() => {
    const frame = frames?.get(location.key);
    if (!frame) return;
    let done = false;
    const restore = () => {
      const surface = activeSurface(false);
      // Detail routes publish their surface after their initial read; a retained list is not ready detail content.
      if (detailPath.test(location.pathname) && !surface) return;
      const body = surface?.body ?? null;
      const scope = body ?? document;
      const target = [...scope.querySelectorAll<HTMLElement>("[data-detail-focus]")].find(link => link.dataset.detailFocus === frame.focusKey);
      const loading = surface?.ready === false;
      if (done || loading || !target && !surface?.ready && !scope.querySelector("[data-list-anchor], [data-page-action], [data-page-ready], [role=alert]")) return;
      done = true;
      (target ?? (!body ? document.querySelector<HTMLElement>("[data-page-action]") : null) ?? surface?.heading ?? document.querySelector<HTMLElement>("h1"))?.focus({ preventScroll: true });
      if (body) body.scrollTop = frame.scroll; else restoreScroll(target ?? document.querySelector("main"), frame.scroll);
    };
    let animation = 0;
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(restore); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy", "data-page-ready"] });
    schedule();
    return () => { cancelAnimationFrame(animation); observer.disconnect(); };
  }, [location.key, frames]);
}
