import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";

/** Current kind authority controls business forms independently of settings access. */
export function useEntityWriteAccess() {
  const capabilities = useWorkspaceCapabilities();
  return (typeId: string) => capabilities?.grants.some((grant) =>
    grant.target_kind === "entity_type" && grant.target_id === typeId && grant.access === "write"
  ) ?? false;
}
