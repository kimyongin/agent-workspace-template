import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";

/** Current kind authority controls business forms independently of settings access. */
export function useEntityWriteAccess() {
  const capabilities = useWorkspaceCapabilities();
  return (typeId: string) => capabilities?.grants.some((grant) =>
    grant.target_kind === "entity_type" && grant.target_id === typeId && grant.access === "write"
  ) ?? false;
}

/** Captured drafts may remain in memory while their current business view is concealed. */
export function useEntityReadAccess() {
  const capabilities = useWorkspaceCapabilities();
  return (typeId: string) => capabilities?.grants.some((grant) =>
    grant.target_kind === "entity_type" && grant.target_id === typeId &&
    (grant.access === "read" || grant.access === "write")
  ) ?? false;
}
