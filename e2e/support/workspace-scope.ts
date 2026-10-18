import { workspacePath } from "../../src/lib/workspace-route.tsx";
/** Explicit tenant used by the older isolated screen fixtures. */
export const fixtureWorkspaceId = "00000000-0000-4000-8000-000000000980";

/** Real App fixtures select this explicit mock workspace; isolated routers keep their own paths. */
export const fixtureWorkspacePath = (path: string) => workspacePath(fixtureWorkspaceId, path);
