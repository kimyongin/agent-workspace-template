import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";

/** Task authority is independent from associated material kind authority. */
export function useTaskAccess() {
  const capabilities = useWorkspaceCapabilities();
  const grant = capabilities?.grants.find(grant => grant.target_kind === "tasks" && grant.target_id === "*");
  return { canRead: grant?.access === "read" || grant?.access === "write", canWrite: grant?.access === "write" };
}
