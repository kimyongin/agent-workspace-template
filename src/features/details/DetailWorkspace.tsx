import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useBlocker, useLocation, useNavigate, type Location, type NavigateOptions, type To } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { DetailTabContext, WorkspaceContext, detailIdentity, workspaceList, type WorkspaceGuard } from "./workspace-context.ts";
import { useWorkspaceResize } from "./useWorkspaceResize.ts";
import { useDisplayScale } from "../settings/display-scale.tsx";
import { DetailTabs } from "./DetailTabs.tsx";
import "./workspace.css";

type Tab = { id: string; location: Location; title: string; returnTo?: string };
const kindLabels: Record<string, string> = { entities: "엔터티", tasks: "할 일", records: "기록", principles: "원칙" };
const href = (location: Location) => `${location.pathname}${location.search}${location.hash}`;
function destination(to: To, from: Location): string {
  if (typeof to !== "string") return `${to.pathname ?? from.pathname}${to.search ? (to.search.startsWith("?") ? to.search : `?${to.search}`) : ""}${to.hash ?? ""}`;
  const url = new URL(to, `https://workspace.invalid${href(from)}`);
  return `${url.pathname}${url.search}${url.hash}`;
}
function ownerList(location: Location): Location {
  const owner = `/${location.pathname.split("/")[1]}`;
  const candidate = new URLSearchParams(location.search).get("list");
  const url = new URL(candidate?.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\") ? candidate : owner, "https://workspace.invalid");
  return { ...location, pathname: url.pathname === owner ? url.pathname : owner, search: url.pathname === owner ? url.search : "", hash: url.pathname === owner ? url.hash : "", state: null, key: `list:${location.key}` };
}

/** One owner for retained detail visits, their URLs and all guards within the desktop workspace. */
export function DetailWorkspace({ children, render, enabled }: { children: ReactNode; render: (location: Location) => ReactNode; enabled: boolean }) {
  const location = useLocation(), navigate = useNavigate();
  const scale = useDisplayScale();
  const desktopQuery = useMemo(() => window.matchMedia(`(min-width: ${1280 * scale / 100}px) and (min-height: ${480 * scale / 100}px)`), [scale]);
  const subscribeDesktop = useCallback((notify: () => void) => {
    desktopQuery.addEventListener("change", notify);
    return () => desktopQuery.removeEventListener("change", notify);
  }, [desktopQuery]);
  const desktop = useSyncExternalStore(subscribeDesktop, () => desktopQuery.matches, () => false);
  const eligible = enabled && (workspaceList(location.pathname) || !!detailIdentity(location.pathname));
  const [started, setStarted] = useState(desktop && eligible);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [revision, setRevision] = useState(0);
  const [listReturnRevision, setListReturnRevision] = useState(0);
  const [identityDestination, setIdentityDestination] = useState<{path:string;owner:string} | null>(null);
  const [base, setBase] = useState<Location>(() => detailIdentity(location.pathname) ? ownerList(location) : location);
  const current = useRef({ tabs, active, base, visible });
  current.current = { tabs, active, base, visible };
  const guards = useRef(new Map<string, () => WorkspaceGuard>());
  const tabFocus = useRef<string | null>(null);
  const openedLocation = useRef<Location | null>(null);
  const registerGuard = useCallback((key: string, guard: () => WorkspaceGuard) => {
    guards.current.set(key, guard);
    return () => { guards.current.delete(key); };
  }, []);
  const anyBusy = useCallback(() => [...guards.current.values()].some(read => read().busy), []);
  const saved = useCallback(() => setRevision(value => value + 1), []);
  // Replaced TabContent has unmounted and removed its busy guard before route transfer.
  useEffect(() => {
    if (!identityDestination) return;
    setIdentityDestination(null);
    void navigate(identityDestination.path, {replace:true,state:{workspaceOwner:identityDestination.owner}});
  }, [identityDestination,navigate]);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const shown = visible && !!active;
  const split = useWorkspaceResize(desktop && shown && started && eligible);
  const listRef = useWorkspaceScroll(started && eligible, desktop && shown, base);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ([...guards.current.values()].some(read => { const guard = read(); return guard.busy || guard.dirty; })) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useLayoutEffect(() => {
    if (!eligible) { setTabs([]); setActive(null); setStarted(false); return; }
    // Do not reparent a mobile form while its native dialog owns an unfinished visit.
    if (!started) {
      if (!desktop || document.querySelector("dialog.modal[open]")) return;
      setStarted(true);
    }
    const id = detailIdentity(location.pathname);
    if (!id) {
      // History can return while the retained list has changed through another client.
      if (current.current.active && detailIdentity(openedLocation.current?.pathname ?? "")) {
        setRevision(value => value + 1);
        setListReturnRevision(value => value + 1);
        tabFocus.current = "list";
      }
      openedLocation.current = location;
      setBase(location); return;
    }
    if (new URLSearchParams(current.current.base.search).has("create")) {
      const search = new URLSearchParams(current.current.base.search); search.delete("create");
      setBase({ ...current.current.base, search: `?${search}`, key: crypto.randomUUID() });
      setRevision(value => value + 1);
    }
    if (openedLocation.current !== location) setVisible(true);
    openedLocation.current = location; setActive(id);
    setTabs(previous => previous.some(tab => tab.id === id)
      ? previous.map(tab => tab.id === id && href(tab.location) !== href(location) ? { ...tab, location } : tab)
      : [...previous, { id, location, title: kindLabels[id.split("/")[1]], returnTo: typeof location.state?.workspaceReturnTo === "string" && previous.some(value => value.id === location.state.workspaceReturnTo) ? location.state.workspaceReturnTo : undefined }]);
  }, [location, eligible, desktop, started]);

  // Related visits remember only their starting tab, never a growing history of cross-links.
  const returnTarget = (origin: Location, target: string | null) => {
    const source = current.current.tabs.find(tab => tab.id === detailIdentity(origin.pathname));
    const root = source?.returnTo ?? source?.id;
    return root && root !== target && current.current.tabs.some(tab => tab.id === root) ? root : undefined;
  };
  const rememberReturn = (target: string | null, returnTo: string | undefined) => {
    if (target && returnTo) setTabs(previous => previous.map(tab => tab.id === target ? {...tab, returnTo} : tab));
  };
  const navigateTab = useCallback((id: string, to: To, options: NavigateOptions = {}) => {
    const state = current.current, tab = state.tabs.find(tab => tab.id === id);
    if (!tab) return;
    const path = destination(to, tab.location), identity = detailIdentity(path);
    if (identity === id) {
      const prior = new URLSearchParams(tab.location.search), next = new URL(path, "https://workspace.invalid").searchParams;
      if (["edit", "action", "create", "occurrence"].some(key => prior.has(key) && !next.has(key))) setRevision(value => value + 1);
      const url = new URL(path, "https://workspace.invalid");
      // A mode transition is a new visit even when its URL matches; selecting a retained tab is not.
      setTabs(previous => previous.map(value => value.id === id ? { ...value, location: { ...value.location, pathname: url.pathname, search: url.search, hash: url.hash, key: crypto.randomUUID() } } : value));
      if (state.active === id) void navigate(path, { replace: true, state: { workspaceOwner: state.base.pathname } });
    } else if (identity && options.state?.rekeyedDetail === id) {
      // A successful identity change replaces this visit and every tab return pointer.
      const url = new URL(path, "https://workspace.invalid");
      setTabs(previous => previous.filter(value => value.id !== identity).map(value => ({
        ...value,
        ...(value.id === id ? {id:identity,location:{...value.location,pathname:url.pathname,search:url.search,hash:url.hash,key:crypto.randomUUID()}} : {}),
        ...(value.returnTo === id ? {returnTo:identity} : {}),
      })));
      if (state.active === id) setActive(identity);
      setIdentityDestination({path,owner:state.base.pathname});
    } else if (identity) {
      const returnTo = returnTarget(tab.location, identity);
      rememberReturn(identity, returnTo);
      void navigate(path, { state: { workspaceOwner: state.base.pathname, workspaceReturnTo: returnTo } });
    }
    else closeTab(id);
  }, [navigate]);
  const closeTab = (id: string) => {
    const state = current.current, index = state.tabs.findIndex(tab => tab.id === id);
    const remaining = state.tabs.filter(tab => tab.id !== id).map(tab => tab.returnTo === id ? {...tab, returnTo: undefined} : tab);
    setTabs(remaining);
    setRevision(value => value + 1);
    if (state.active !== id) { tabFocus.current = state.active; return; }
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (!next) setListReturnRevision(value => value + 1);
    tabFocus.current = next?.id ?? "list";
    setActive(next?.id ?? null);
    void navigate(next ? href(next.location) : href(state.base), { replace: true, state: next ? { workspaceOwner: state.base.pathname } : null });
  };
  const requestClose = (id: string) => {
    if (anyBusy()) return;
    const guard = guards.current.get(id)?.();
    if (guard?.dirty) setDiscard(() => () => closeTab(id)); else closeTab(id);
  };
  const open = useCallback((to: To, origin: Location) => {
    if (anyBusy()) return;
    const state = current.current, path = destination(to, origin), identity = detailIdentity(path);
    const existing = state.tabs.find(tab => tab.id === identity);
    if (workspaceList(origin.pathname)) setBase(origin);
    setVisible(true);
    if (existing && state.active === identity && href(location) === href(existing.location)) return;
    const returnTo = returnTarget(origin, identity);
    rememberReturn(identity, returnTo);
    const visit = () => navigate(existing ? href(existing.location) : path, { replace: !!existing, state: { workspaceOwner: workspaceList(origin.pathname) ? origin.pathname : state.base.pathname, workspaceReturnTo: returnTo } });
    // Persist the list anchor in its history entry too, not only in the retained pane.
    if (workspaceList(location.pathname) && workspaceList(origin.pathname) && href(origin) !== href(location)) {
      void Promise.resolve(navigate(href(origin), { replace: true, state: location.state, preventScrollReset: true })).then(visit);
    } else void visit();
  }, [navigate, location, anyBusy]);
  const select = (tab: Tab) => {
    if (anyBusy()) return;
    tabFocus.current = tab.id;
    open(href(tab.location), base);
    document.getElementById(`tab-${tab.id}`)?.focus();
  };
  const reorder = (id: string, target: string, before: boolean) => {
    if (anyBusy() || id === target) return null;
    const state = current.current.tabs;
    const tab = state.find(tab => tab.id === id);
    if (!tab || !state.some(tab => tab.id === target)) return null;
    const next = state.filter(tab => tab.id !== id);
    const index = next.findIndex(tab => tab.id === target) + (before ? 0 : 1);
    if (state.findIndex(tab => tab.id === id) === index) return null;
    next.splice(index, 0, tab); setTabs(next);
    return index;
  };
  useEffect(() => {
    if (!desktop || !visible) return;
    const frame = requestAnimationFrame(() => {
      let anchor:HTMLElement|null = null;
      try {
        const candidate = base.hash ? document.getElementById(decodeURIComponent(base.hash.slice(1))) : null;
        if (candidate && listRef.current?.contains(candidate) && candidate.matches(".item-title")) anchor = candidate;
      } catch { /* A malformed external fragment falls back to the list heading. */ }
      const button = tabFocus.current === "list" ? anchor ?? listRef.current?.querySelector<HTMLElement>("h1") : document.getElementById(`tab-${active}`);
      if (tabFocus.current === "list" && !anchor) button?.setAttribute("tabindex", "-1");
      if (tabFocus.current) button?.focus({ preventScroll: true });
      if (tabFocus.current !== "list") button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      tabFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, visible, desktop, tabs.length, tabs.find(tab => tab.id === active)?.title, listRef, base.hash, base.key]);
  if (!started || !eligible) return children;
  return <WorkspaceContext.Provider value={{ revision, listReturnRevision, saved, open, registerGuard }}><div ref={split.ref} style={split.style} className={`detail-workspace${desktop && shown ? " has-detail-panel" : ""}${split.dragging ? " is-resizing" : ""}`}>
    <div className="workspace-list" ref={listRef}>{render(base)}
      {desktop && !visible && tabs.length > 0 && <button className="btn workspace-reopen" onClick={() => setVisible(true)}>상세 탭 보기 ({tabs.length}개)</button>}
    </div>
    <div className="pane-resize-handle workspace-resize-handle" {...split.separator}/>
    <aside className="workspace-details" id="workspace-details" hidden={!shown} aria-label="상세 작업 영역">
      <div className="workspace-tab-bar" hidden={!desktop}>
        <DetailTabs tabs={tabs} active={active} enabled={desktop && shown} isBusy={anyBusy}
          select={id => { const tab = current.current.tabs.find(tab => tab.id === id); if (tab) select(tab); }} close={requestClose} reorder={reorder}/>
        <button className="workspace-hide" aria-label="상세 패널 숨기기" title="패널 닫기" onClick={() => { if (!anyBusy()) setVisible(false); }}>×</button>
      </div>
      {tabs.map(tab => <TabContent key={tab.id} tab={tab} active={shown && active === tab.id} docked={desktop}
        previous={tab.returnTo && tabs.some(value => value.id === tab.returnTo) ? {
          label: `이전: ${tabs.find(value => value.id === tab.returnTo)!.title}`,
          back: () => { const root = current.current.tabs.find(value => value.id === tab.returnTo); if (root) select(root); },
        } : null}
        navigate={(to, options) => navigateTab(tab.id, to, options)} close={() => requestClose(tab.id)} registerGuard={registerGuard}
        title={title => setTabs(previous => previous.map(value => value.id === tab.id && value.title !== title ? { ...value, title } : value))}>
        {render(tab.location)}
      </TabContent>)}
    </aside>
    <ConfirmDialog open={!!discard} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
      onCancel={() => setDiscard(null)} onConfirm={() => { discard?.(); setDiscard(null); }}/>
    <WorkspaceRouteProtection guards={guards}/>
  </div></WorkspaceContext.Provider>;
}

/** Transfer the list position when its scroll owner changes between the page and split pane. */
function useWorkspaceScroll(enabled: boolean, split: boolean, base: Location) {
  const element = useRef<HTMLDivElement>(null);
  const position = useRef({ pathname: base.pathname, top: Number(new URLSearchParams(base.search).get("scroll")) || window.scrollY, split });
  useLayoutEffect(() => {
    if (!enabled || !element.current) return;
    const saved = position.current;
    if (saved.pathname !== base.pathname) saved.top = Number(new URLSearchParams(base.search).get("scroll")) || 0;
    saved.pathname = base.pathname; saved.split = split;
    if (split) element.current.scrollTop = saved.top;
    else window.scrollTo({ top: saved.top, behavior: "instant" });
  }, [enabled, split, base.pathname]);
  useEffect(() => {
    const list = element.current;
    if (!enabled || !list) return;
    const rememberList = () => { if (position.current.split) position.current.top = list.scrollTop; };
    const rememberPage = () => { if (!position.current.split) position.current.top = window.scrollY; };
    list.addEventListener("scroll", rememberList); window.addEventListener("scroll", rememberPage);
    return () => { list.removeEventListener("scroll", rememberList); window.removeEventListener("scroll", rememberPage); };
  }, [enabled]);
  return element;
}

function WorkspaceRouteProtection({ guards }: { guards: RefObject<Map<string, () => WorkspaceGuard>> }) {
  const blocked = useRef<WorkspaceGuard[]>([]);
  const blocker = useBlocker(({ nextLocation }) => {
    const staying = workspaceList(nextLocation.pathname) || !!detailIdentity(nextLocation.pathname);
    blocked.current = [...guards.current.values()].map(read => read()).filter(guard => guard.busy || guard.dirty && (!staying || !guard.retained));
    return blocked.current.length > 0;
  });
  useEffect(() => { if (blocker.state === "blocked" && blocked.current.some(guard => guard.busy)) blocker.reset(); }, [blocker]);
  return <ConfirmDialog open={blocker.state === "blocked" && !blocked.current.some(guard => guard.busy)} title="변경을 버릴까요?" message="열린 화면의 저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
    onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}
    onConfirm={() => { if (blocker.state === "blocked") { blocked.current.forEach(guard => guard.discard()); blocker.proceed(); } }}/>
}

function TabContent({ tab, active, docked, previous, navigate, close, title, registerGuard, children }: { tab: Tab; active: boolean; docked: boolean; previous: {label: string; back: () => void} | null; navigate: (to: To, options?: NavigateOptions) => void; close: () => void; title: (value: string) => void; registerGuard: (id: string, read: () => WorkspaceGuard) => () => void; children: ReactNode }) {
  const guard = useRef<WorkspaceGuard>({ dirty: false, busy: false, retained: true, discard: () => {} });
  useLayoutEffect(() => registerGuard(tab.id, () => guard.current), [tab.id, registerGuard]);
  // A stable title publisher prevents resource renders from feeding back into the workspace.
  const publish = useRef(title); publish.current = title;
  const updateTitle = useCallback((value: string) => publish.current(value), []);
  return <DetailTabContext.Provider value={{ id: tab.id, active, docked, previous, navigate, close, title: updateTitle, guard: value => { guard.current = value; } }}>
    <div role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={!active}>{children}</div>
  </DetailTabContext.Provider>;
}
