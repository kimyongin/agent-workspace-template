import { cn } from "cn";
import { Tabs, TabsContent } from "../../components/ui/tabs.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../components/ui/resizable.tsx";
import { Button } from "../../components/ui/button.tsx";
import { XIcon } from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { activeSurface, registerScrollOwner, scrollOwner, restoreScroll } from "../../lib/surface-dom.ts";
import { useNavigationBlocker, useNavigationBusy } from "../../lib/navigation-protection.tsx";
import { entityListAnchor, detailListReturn } from "../../lib/entity-list-url.ts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate, useNavigationType, type Location, type NavigateOptions, type To } from "../../lib/workspace-router.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { DetailTabContext, WorkspaceContext, detailIdentity, workspaceList, workspaceBase, materialSettingsBase, type WorkspaceGuard } from "./workspace-context.ts";
import { useDisplayScale } from "../settings/display-scale.tsx";
import { DetailTabs } from "./DetailTabs.tsx";

type Tab = { id: string; location: Location; title: string; returnTo?: string };
const kindLabels: Record<string, string> = { entities: "자료", tasks: "할 일", records: "기록" };
const href = (location: Location) => `${location.pathname}${location.search}${location.hash}`;
function destination(to: To, from: Location): string {
  if (typeof to !== "string") return `${to.pathname ?? from.pathname}${to.search ? (to.search.startsWith("?") ? to.search : `?${to.search}`) : ""}${to.hash ?? ""}`;
  const url = new URL(to, `https://workspace.invalid${href(from)}`);
  return `${url.pathname}${url.search}${url.hash}`;
}
function ownerList(location: Location): Location {
  const owner = `/${location.pathname.split("/")[1]}`;
  const url = new URL(detailListReturn(location) ?? owner, "https://workspace.invalid");
  return { ...location, pathname: url.pathname, search: url.search, hash: url.hash, state: null, key: `list:${location.key}` };
}

/** One owner for retained detail visits, their URLs and all guards within the desktop workspace. */
export function DetailWorkspace({ children, render, enabled }: { children: ReactNode; render: (location: Location) => ReactNode; enabled: boolean }) {
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType();
  const scale = useDisplayScale();
  const desktopQuery = useMemo(() => window.matchMedia(`(min-width: ${1280 * scale / 100}px) and (min-height: ${480 * scale / 100}px)`), [scale]);
  const subscribeDesktop = useCallback((notify: () => void) => {
    desktopQuery.addEventListener("change", notify);
    return () => desktopQuery.removeEventListener("change", notify);
  }, [desktopQuery]);
  const desktop = useSyncExternalStore(subscribeDesktop, () => desktopQuery.matches, () => false);
  const eligible = enabled && (workspaceBase(location.pathname) || !!detailIdentity(location.pathname));
  // Settings and other base pages keep one parent when a mobile screen grows into the split layout.
  const retainedBase = workspaceBase(location.pathname) && !workspaceList(location.pathname);
  const [started, setStarted] = useState(eligible && (desktop || retainedBase));
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [revision, setRevision] = useState(0);
  const [identityDestination, setIdentityDestination] = useState<{path:string;owner:string} | null>(null);
  const [base, setBase] = useState<Location>(() => detailIdentity(location.pathname) ? ownerList(location) : location);
  const current = useRef({ tabs, active, base, visible });
  current.current = { tabs, active, base, visible };
  const guards = useRef(new Map<string, () => WorkspaceGuard>());
  const baseFocus = useRef<HTMLElement | null>(null);
  const tabFocus = useRef<string | null>(null);
  const openedLocation = useRef<Location | null>(null);
  const pendingVisit = useRef<string | null>(null);
  const registerGuard = useCallback((key: string, guard: () => WorkspaceGuard) => {
    guards.current.set(key, guard);
    return () => { guards.current.delete(key); };
  }, []);
  const navigationBusy = useNavigationBusy();
  const anyBusy = useCallback(() => navigationBusy() || [...guards.current.values()].some(read => read().busy), [navigationBusy]);
  const saved = useCallback(() => setRevision(value => value + 1), []);
  // Replaced or closed TabContent removes its busy guard before the route transfer.
  useEffect(() => {
    if (!identityDestination) return;
    setIdentityDestination(null);
    pendingVisit.current = null;
    void navigate(identityDestination.path, {replace:true,state:{workspaceOwner:identityDestination.owner}});
  }, [identityDestination,navigate]);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const shown = visible && !!active;
  const detailPanel = useRef<PanelImperativeHandle | null>(null);
  const groupElement = useRef<HTMLDivElement>(null);
  const handleElement = useRef<HTMLDivElement>(null);
  const minimums = useFeasiblePanelMinimums(groupElement, handleElement, started && eligible && desktop && shown);
  const detailRatio = useRef(46);
  const rememberResize = useRef(false);
  useLayoutEffect(() => {
    rememberResize.current = false;
    // Panel constraints register after this render; restore the user's proportion once they are live.
    const frame = requestAnimationFrame(() => detailPanel.current?.resize(desktop && shown ? `${detailRatio.current}%` : 0));
    return () => cancelAnimationFrame(frame);
  }, [desktop, shown]);
  const listRef = useWorkspaceScroll(started && eligible, desktop && shown, base);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if ([...guards.current.values()].some(read => { const guard = read(); return guard.busy || guard.dirty; })) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  useLayoutEffect(() => {
    if (openedLocation.current !== location && (navigationType === "POP" || !eligible || !detailIdentity(location.pathname) || pendingVisit.current === href(location))) pendingVisit.current = null;
    if (!eligible) { setTabs([]); setActive(null); setStarted(false); return; }
    // Do not reparent a mobile form while its native dialog owns an unfinished visit.
    if (!started) {
      if ((!desktop && !retainedBase) || activeSurface(false)) return;
      setStarted(true);
    }
    const id = detailIdentity(location.pathname);
    if (!id) {
      if (current.current.active && detailIdentity(openedLocation.current?.pathname ?? "")) {
        setRevision(value => value + 1);
        // Desktop navigation changes the left pane, preserving the user's panel visibility.
        if (!desktop) setVisible(false);
        tabFocus.current = "list";
      }
      openedLocation.current = location;
      setBase(location);
      return;
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
  }, [location, navigationType, eligible, desktop, started, retainedBase]);

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
      if (state.active === id) { pendingVisit.current = null; void navigate(path, { replace: true, state: { workspaceOwner: state.base.pathname } }); }
    } else if (identity) {
      const returnTo = returnTarget(tab.location, identity);
      rememberReturn(identity, returnTo);
      pendingVisit.current = path;
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
    tabFocus.current = next?.id ?? "list";
    setActive(next?.id ?? null);
    setIdentityDestination({path:next ? href(next.location) : href(state.base),owner:state.base.pathname});
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
    if (workspaceBase(origin.pathname)) { setBase(origin); if(materialSettingsBase(origin.pathname) && !detailIdentity(location.pathname))baseFocus.current=document.activeElement instanceof HTMLElement ? document.activeElement : null; }
    // A prior visit can be pending while React still renders this target as selected.
    if (existing && state.active === identity && href(location) === href(existing.location) && (!pendingVisit.current || pendingVisit.current === href(existing.location))) { setVisible(true); return; }
    const returnTo = returnTarget(origin, identity);
    rememberReturn(identity, returnTo);
    const visit = () => {
      const target = existing ? href(existing.location) : path;
      pendingVisit.current = target;
      return navigate(target, { replace: !!existing && !!detailIdentity(location.pathname), state: { workspaceOwner: workspaceBase(origin.pathname) ? origin.pathname : state.base.pathname, workspaceReturnTo: returnTo } });
    };
    // Back must return to the same row context as the retained list pane.
    if (workspaceList(location.pathname) && workspaceList(origin.pathname) && href(origin) !== href(location)) {
      void Promise.resolve(navigate(href(origin), { replace: true, state: location.state, preventScrollReset: true })).then(visit);
    } else void visit();
  }, [navigate, location, anyBusy]);
  const select = (tab: Tab, focusTab = true) => {
    if (anyBusy()) return;
    tabFocus.current = focusTab ? tab.id : null;
    open(href(tab.location), base);
    if (focusTab) document.getElementById(`tab-${tab.id}`)?.focus();
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
    if ((!desktop && !materialSettingsBase(base.pathname)) || (!visible && tabFocus.current !== "list")) return;
    const frame = requestAnimationFrame(() => {
      let anchor:HTMLElement|null = null;
      try {
        const listAnchor = base.pathname === "/entities" ? entityListAnchor(base.hash) : base.hash;
        const candidate = listAnchor ? document.getElementById(decodeURIComponent(listAnchor.slice(1))) : null;
        if (candidate && listRef.current?.contains(candidate) && candidate.hasAttribute("data-list-anchor")) anchor = candidate;
      } catch { /* A malformed external fragment falls back to the list heading. */ }
      const button = tabFocus.current === "list" ? (materialSettingsBase(base.pathname) && baseFocus.current?.isConnected ? baseFocus.current : null) ?? anchor ?? listRef.current?.querySelector<HTMLElement>("h1") : document.getElementById(`tab-${active}`);
      if (tabFocus.current === "list" && !anchor) button?.setAttribute("tabindex", "-1");
      if (tabFocus.current) button?.focus({ preventScroll: true });
      if (tabFocus.current !== "list") button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      tabFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, visible, desktop, tabs.length, tabs.find(tab => tab.id === active)?.title, listRef, base.hash]);
  // Base editors use the same retained parent on the first authenticated render and after startup commits.
  if ((!started && !retainedBase) || !eligible) return <div className="min-w-0 p-4 lg:p-6">{children}</div>;
  return <WorkspaceContext.Provider value={{ revision, navigationKey: location.key, saved, open, registerGuard }}>
    <ResizablePanelGroup elementRef={groupElement} orientation="horizontal" style={{ height: desktop && shown ? "100%" : "auto" }} className={cn("min-h-0 min-w-0", desktop && shown ? "h-[calc(100dvh-3.5rem)]" : "h-auto")} resizeTargetMinimumSize={{ coarse: 44, fine: 44 }}>
      <ResizablePanel id="list" minSize={desktop && shown ? minimums.list : 0} className="min-w-0">
        <div className={cn("flex min-w-0 flex-col gap-5 p-4 lg:p-6", desktop && shown && "h-full overflow-y-auto overscroll-contain")} ref={listRef} role="region" aria-label="기본 작업 영역">
          {render(base)}
          {desktop && !visible && tabs.length > 0 && <Button variant="outline" className="self-end" onClick={() => setVisible(true)}>상세 탭 보기 ({tabs.length}개)</Button>}
        </div>
      </ResizablePanel>
      {desktop && shown && <ResizableHandle elementRef={handleElement} aria-label="상세 패널 너비 조절" className="w-2 shrink-0" onPointerDownCapture={() => { rememberResize.current = true; }} onKeyDownCapture={() => { rememberResize.current = true; }} onDoubleClick={() => { detailRatio.current = 46; detailPanel.current?.resize("46%"); }} />}
      <ResizablePanel id="detail" panelRef={detailPanel} minSize={desktop && shown ? minimums.detail : 0} maxSize={desktop && shown ? "70%" : 0} defaultSize={desktop && shown ? "46%" : 0} onResize={size => { if (rememberResize.current && desktop && shown && size.asPercentage > 0) detailRatio.current = size.asPercentage; }} className="min-w-0">
        <aside className="flex h-full min-h-0 min-w-0 flex-col border-l bg-card" id="workspace-details" hidden={!shown} aria-label="상세 작업 영역">
          {/* The visit model activates clicks and keys; pointer-down activation would change the URL before a drag. */}
          <Tabs value={active ?? ""} activationMode="manual" className="h-full min-h-0 gap-0">
            <div className="flex min-w-0 shrink-0 items-center border-b" hidden={!desktop}>
              <DetailTabs tabs={tabs} active={active} enabled={desktop && shown} isBusy={anyBusy} select={id => { const tab = current.current.tabs.find(tab => tab.id === id); if (tab) select(tab); }} close={requestClose} reorder={reorder} />
              <Button variant="ghost" size="icon" aria-label="상세 패널 숨기기" onClick={() => { if (!anyBusy()) setVisible(false); }}><XIcon /></Button>
            </div>
      {tabs.map(tab => <TabContent key={tab.id} tab={tab} active={shown && active === tab.id} docked={desktop}
        previous={tab.returnTo && tabs.some(value => value.id === tab.returnTo) ? {
          label: `이전: ${tabs.find(value => value.id === tab.returnTo)!.title}`,
          back: () => { const root = current.current.tabs.find(value => value.id === tab.returnTo); if (root) select(root, false); },
        } : null}
        navigate={(to, options) => navigateTab(tab.id, to, options)} close={() => requestClose(tab.id)} registerGuard={registerGuard}
        title={title => setTabs(previous => previous.map(value => value.id === tab.id && value.title !== title ? { ...value, title } : value))}>
        {render(tab.location)}
      </TabContent>)}
          </Tabs>
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>
    <ConfirmDialog open={!!discard} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기" onCancel={() => setDiscard(null)} onConfirm={() => { discard?.(); setDiscard(null); }} />
    <WorkspaceRouteProtection guards={guards} />
  </WorkspaceContext.Provider>;
}

/** Nominal rem minima shrink equally toward half the available split when text grows. */
function useFeasiblePanelMinimums(group: RefObject<HTMLDivElement | null>, handle: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [minimums, setMinimums] = useState({ list: "28rem", detail: "27rem" });
  useLayoutEffect(() => {
    const element = group.current;
    if (!enabled || !element) return;
    const measure = () => {
      const available = element.clientWidth - (handle.current?.offsetWidth ?? 0);
      if (available <= 0) return;
      const rem = parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize);
      const cap = 55 * rem > available ? available / 2 : Infinity;
      // Match the official Group axis, including each panel's integer offset-width rounding.
      const axis = [...element.children].filter(child => child.hasAttribute("data-panel"))
        .reduce((total, child) => total + (child as HTMLElement).offsetWidth, 0);
      if (axis <= 0) return;
      const next = { list: `${100 * Math.min(28 * rem, cap) / axis}%`, detail: `${100 * Math.min(27 * rem, cap) / axis}%` };
      setMinimums(previous => previous.list === next.list && previous.detail === next.detail ? previous : next);
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    if (handle.current) observer.observe(handle.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [group, handle, enabled]);
  return minimums;
}

/** Transfer the list position when its scroll owner changes between the page and split pane. */
function useWorkspaceScroll(enabled: boolean, split: boolean, base: Location) {
  const element = useRef<HTMLDivElement>(null);
  const ownsScroll = useRef(split); ownsScroll.current = split;
  useLayoutEffect(() => element.current ? registerScrollOwner(element.current, () => ownsScroll.current) : undefined, [enabled]);
  const position = useRef({ pathname: base.pathname, top: Number(new URLSearchParams(base.search).get("scroll")) || window.scrollY, split });
  useLayoutEffect(() => {
    if (!enabled || !element.current) return;
    const saved = position.current;
    if (saved.pathname !== base.pathname) saved.top = Number(new URLSearchParams(base.search).get("scroll")) || 0;
    saved.pathname = base.pathname; saved.split = split;
    if (split) element.current.scrollTop = saved.top;
    else restoreScroll(element.current.parentElement, saved.top);
  }, [enabled, split, base.pathname]);
  useEffect(() => {
    const list = element.current;
    if (!enabled || !list) return;
    const rememberList = () => { if (position.current.split) position.current.top = list.scrollTop; };
    const page = scrollOwner(list.parentElement);
    const rememberPage = () => { if (!position.current.split) position.current.top = page?.scrollTop ?? window.scrollY; };
    list.addEventListener("scroll", rememberList); (page ?? window).addEventListener("scroll", rememberPage);
    return () => { list.removeEventListener("scroll", rememberList); (page ?? window).removeEventListener("scroll", rememberPage); };
  }, [enabled]);
  return element;
}

function WorkspaceRouteProtection({ guards }: { guards: RefObject<Map<string, () => WorkspaceGuard>> }) {
  const blocked = useRef<WorkspaceGuard[]>([]);
  const blocker = useNavigationBlocker(({ nextLocation }) => {
    const staying = workspaceBase(nextLocation.pathname) || !!detailIdentity(nextLocation.pathname);
    blocked.current = [...guards.current.values()].map(read => read()).filter(guard => guard.busy || guard.dirty && (!staying || !guard.retained || guard.allows && !guard.allows(nextLocation.pathname,nextLocation.search)));
    return blocked.current.length > 0;
  }, () => [...guards.current.values()].some(read => read().busy), 10);
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
    <TabsContent value={tab.id} forceMount id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={!active} className="min-h-0 data-[state=inactive]:hidden">{children}</TabsContent>
  </DetailTabContext.Provider>;
}
