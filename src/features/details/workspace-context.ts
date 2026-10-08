import { createContext } from "react";
import type { Location, NavigateOptions, To } from "react-router";

export const detailIdentity = (path: string) => path.split(/[?#]/)[0].match(/^\/(entities|tasks|records|principles)\/[^/]+$/)?.[0] ?? null;
export const workspaceList = (path: string) => /^\/(entities|tasks|records|principles|search)$/.test(path);
export type WorkspaceGuard = { dirty: boolean; busy: boolean; discard: () => void; retained: boolean };
export const WorkspaceContext = createContext<{
  revision: number;
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
