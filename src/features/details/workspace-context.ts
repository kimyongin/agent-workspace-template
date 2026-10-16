import { createContext } from "react";
import type { Location, NavigateOptions, To } from "react-router";

export const detailIdentity = (path: string) => path.split(/[?#]/)[0].match(/^\/(entities|tasks|records)\/[^/]+$/)?.[0] ?? null;
export const workspaceList = (path: string) => /^\/(entities|tasks|records|search)$/.test(path);
export const materialSettingsBase = (path: string) => /^\/settings\/(?:entity-types|materials)(?:\/[^/]+(?:\/(?:versions|migrations)(?:\/[^/]+)?)?)?$/.test(path);
export const workspaceBase = (path: string) => workspaceList(path) || materialSettingsBase(path);
export type WorkspaceGuard = { dirty: boolean; busy: boolean; discard: () => void; retained: boolean; allows?: (path: string, search?: string) => boolean };
export const WorkspaceContext = createContext<{
  revision: number;
  navigationKey?: string;
  saved: () => void;
  open: (to: To, origin: Location) => void;
  registerGuard: (key: string, guard: () => WorkspaceGuard) => () => void;
} | null>(null);
export const DetailTabContext = createContext<{
  id: string;
  active: boolean;
  docked: boolean;
  previous: {label: string; back: () => void} | null;
  navigate: (to: To, options?: NavigateOptions) => void;
  close: () => void;
  title: (value: string) => void;
  guard: (value: WorkspaceGuard) => void;
} | null>(null);
