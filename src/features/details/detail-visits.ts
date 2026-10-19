import type { Location, NavigateOptions, To } from "../../lib/workspace-router.tsx";
import { detailListReturn } from "../../lib/entity-list-url.ts";
import { detailIdentity, workspaceBase, workspaceList } from "./workspace-context.ts";

export type DetailVisit = { id: string; location: Location; title: string; returnTo?: string };
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

/** Owns retained visits and their route intent; DOM guards and rendering stay with DetailWorkspace. */
export function createDetailVisits(initial: Location, navigate: (path: string, options?: NavigateOptions) => void | Promise<void>) {
  let state = { tabs: [] as DetailVisit[], active: null as string | null, base: detailIdentity(initial.pathname) ? ownerList(initial) : initial, visible: true, revision: 0, routeTransfer: null as { path: string; owner: string } | null };
  let location = initial;
  let openedLocation: Location | null = null;
  let pendingVisit: string | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const returnTarget = (origin: Location, target: string | null) => {
    const source = state.tabs.find(tab => tab.id === detailIdentity(origin.pathname));
    const root = source?.returnTo ?? source?.id;
    return root && root !== target && state.tabs.some(tab => tab.id === root) ? root : undefined;
  };
  const rememberReturn = (target: string | null, returnTo: string | undefined) => {
    if (target && returnTo) publish({ tabs: state.tabs.map(tab => tab.id === target ? { ...tab, returnTo } : tab) });
  };
  const close = (id: string) => {
    const index = state.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const remaining = state.tabs.filter(tab => tab.id !== id).map(tab => tab.returnTo === id ? { ...tab, returnTo: undefined } : tab);
    const next = remaining[Math.min(index, remaining.length - 1)];
    const selected = state.active === id;
    publish({ tabs: remaining, revision: state.revision + 1, ...(selected ? { active: next?.id ?? null, routeTransfer: { path: next ? href(next.location) : href(state.base), owner: state.base.pathname } } : {}) });
    return selected ? next?.id ?? "list" : state.active;
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close,
    reset(next: Location) {
      location = next;
      pendingVisit = null;
      publish({ tabs: [], active: null, routeTransfer: null });
    },
    setVisible(visible: boolean) { if (visible !== state.visible) publish({ visible }); },
    saved() { publish({ revision: state.revision + 1 }); },
    title(id: string, title: string) {
      if (!state.tabs.some(tab => tab.id === id && tab.title !== title)) return;
      publish({ tabs: state.tabs.map(tab => tab.id === id && tab.title !== title ? { ...tab, title } : tab) });
    },
    reorder(id: string, target: string, before: boolean) {
      if (id === target) return null;
      const tab = state.tabs.find(tab => tab.id === id);
      if (!tab || !state.tabs.some(tab => tab.id === target)) return null;
      const next = state.tabs.filter(tab => tab.id !== id);
      const index = next.findIndex(tab => tab.id === target) + (before ? 0 : 1);
      if (state.tabs.findIndex(tab => tab.id === id) === index) return null;
      next.splice(index, 0, tab);
      publish({ tabs: next });
      return index;
    },
    transferRoute() {
      const transfer = state.routeTransfer;
      if (!transfer) return;
      pendingVisit = null;
      publish({ routeTransfer: null });
      void navigate(transfer.path, { replace: true, state: { workspaceOwner: transfer.owner } });
    },
    acceptRoute(next: Location, navigationType: string, desktop: boolean) {
      location = next;
      if (openedLocation !== next && (navigationType === "POP" || !detailIdentity(next.pathname) || pendingVisit === href(next))) pendingVisit = null;
      const id = detailIdentity(next.pathname);
      if (!id) {
        const leavingDetail = !!state.active && !!detailIdentity(openedLocation?.pathname ?? "");
        openedLocation = next;
        publish({ base: next, ...(leavingDetail ? { revision: state.revision + 1, ...(!desktop ? { visible: false } : {}) } : {}) });
        return leavingDetail;
      }
      const tabs = state.tabs.some(tab => tab.id === id)
        ? state.tabs.map(tab => tab.id === id && href(tab.location) !== href(next) ? { ...tab, location: next } : tab)
        : [...state.tabs, { id, location: next, title: kindLabels[id.split("/")[1]], returnTo: typeof next.state?.workspaceReturnTo === "string" && state.tabs.some(value => value.id === next.state.workspaceReturnTo) ? next.state.workspaceReturnTo : undefined }];
      const search = new URLSearchParams(state.base.search);
      const creationEnded = search.has("create");
      search.delete("create");
      publish({ tabs, active: id, ...(openedLocation !== next ? { visible: true } : {}), ...(creationEnded ? { base: { ...state.base, search: `?${search}`, key: crypto.randomUUID() }, revision: state.revision + 1 } : {}) });
      openedLocation = next;
      return false;
    },
    open(to: To, origin: Location) {
      const sourceLocation = location, sourceBase = state.base;
      const path = destination(to, origin), identity = detailIdentity(path);
      const existing = state.tabs.find(tab => tab.id === identity);
      if (workspaceBase(origin.pathname)) publish({ base: origin });
      if (existing && state.active === identity && href(location) === href(existing.location) && (!pendingVisit || pendingVisit === href(existing.location))) { publish({ visible: true }); return; }
      const returnTo = returnTarget(origin, identity);
      rememberReturn(identity, returnTo);
      const visit = () => {
        const target = existing ? href(existing.location) : path;
        pendingVisit = target;
        return navigate(target, { replace: !!existing && !!detailIdentity(sourceLocation.pathname), state: { workspaceOwner: workspaceBase(origin.pathname) ? origin.pathname : sourceBase.pathname, workspaceReturnTo: returnTo } });
      };
      if (workspaceList(sourceLocation.pathname) && workspaceList(origin.pathname) && href(origin) !== href(sourceLocation)) {
        void Promise.resolve(navigate(href(origin), { replace: true, state: sourceLocation.state, preventScrollReset: true })).then(visit);
      } else void visit();
    },
    navigateTab(id: string, to: To) {
      const tab = state.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const path = destination(to, tab.location), identity = detailIdentity(path);
      if (identity === id) {
        const prior = new URLSearchParams(tab.location.search), url = new URL(path, "https://workspace.invalid");
        const modeEnded = ["edit", "action", "create", "occurrence"].some(key => prior.has(key) && !url.searchParams.has(key));
        publish({ tabs: state.tabs.map(value => value.id === id ? { ...value, location: { ...value.location, pathname: url.pathname, search: url.search, hash: url.hash, key: crypto.randomUUID() } } : value), ...(modeEnded ? { revision: state.revision + 1 } : {}) });
        if (state.active === id) { pendingVisit = null; void navigate(path, { replace: true, state: { workspaceOwner: state.base.pathname } }); }
      } else if (identity) {
        const returnTo = returnTarget(tab.location, identity);
        rememberReturn(identity, returnTo);
        pendingVisit = path;
        void navigate(path, { state: { workspaceOwner: state.base.pathname, workspaceReturnTo: returnTo } });
      } else return close(id);
    },
  };
}
