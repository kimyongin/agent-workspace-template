import { createContext, useContext } from "react";
export const WorkspaceRouteContext = createContext<string | null>(null);
export const WorkspacePathPrefixContext = createContext(true);
export function useWorkspacePathPrefix() {
  return useContext(WorkspacePathPrefixContext);
}
export function useWorkspaceId() {
  return useContext(WorkspaceRouteContext);
}
export function workspacePath(workspaceId: string, path = "/tasks") {
  return `/w/${encodeURIComponent(workspaceId)}${path}`;
}
export function businessPath(path: string) {
  return path.replace(/^\/w\/[^/]+(?=\/|$)/, "") || "/";
}
