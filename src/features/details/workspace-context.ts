import { useNavigationBlocker } from "../../lib/navigation-protection.tsx";
import { createContext, useContext } from "react";
import { type Location, type NavigateOptions, type To, useLocation } from "../../lib/workspace-router.tsx";

export const detailIdentity = (path: string) =>
  path.split(/[?#]/)[0].match(/^\/(entities|tasks|records)\/[^/]+$/)?.[0] ?? null;
export const workspaceList = (path: string) => /^\/(entities|tasks|records|search)$/.test(path);
export const materialSettingsBase = (path: string) =>
  /^\/settings\/(?:entity-types|materials)(?:\/[^/]+(?:\/(?:versions|migrations)(?:\/[^/]+)?)?)?$/.test(path);
export const workspaceBase = (path: string) =>
  workspaceList(path) || /^\/(settings|guide|tags|status)(?:\/|$)/.test(path);
export type WorkspaceGuard = {
  dirty: boolean;
  busy: boolean;
  discard: () => void;
  retained: boolean;
  allows?: (path: string, search?: string) => boolean;
};
export const WorkspaceContext = createContext<
  {
    revision: number;
    navigationKey?: string;
    saved: () => void;
    open: (to: To, origin: Location) => void;
    registerGuard: (key: string, guard: () => WorkspaceGuard) => () => void;
  } | null
>(null);
export const DetailTabContext = createContext<
  {
    id: string;
    active: boolean;
    docked: boolean;
    previous: { label: string; back: () => void } | null;
    navigate: (to: To, options?: NavigateOptions) => void;
    close: () => void;
    title: (value: string) => void;
    guard: (value: WorkspaceGuard) => void;
  } | null
>(null);

/** Detail tab navigation retains the base screen only while its workspace is mounted. */
export function usePageNavigationBlocker(dirty: boolean, busy: boolean) {
  const workspace = useContext(WorkspaceContext);
  const base = useLocation();
  return useNavigationBlocker(({ nextLocation }) => {
    const retainsBase = workspace && (detailIdentity(nextLocation.pathname) ||
      nextLocation.pathname === base.pathname && nextLocation.search === base.search && nextLocation.hash === base.hash);
    return busy || dirty && !retainsBase;
  }, busy);
}
