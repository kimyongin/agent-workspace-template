import { WorkspaceCapabilitiesContext } from "../../src/features/workspaces/workspace-context.tsx";
/** Explicit browser fixture adapters only. Production keeps SDK authentication and URL space scope. */
import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useContext, useMemo } from "react";
import { AuthContext } from "../../src/features/auth/auth-context.ts";
import { ApiSessionContext } from "../../src/lib/api-context.tsx";
import {
  WorkspacePathPrefixContext,
  WorkspaceRouteContext,
} from "../../src/lib/workspace-route.tsx";
import { fixtureWorkspaceId } from "../support/workspace-scope.ts";
export { fixtureWorkspaceId } from "../support/workspace-scope.ts";
export function FixtureWorkspace(
  { children, actorId }: { children: ReactNode; actorId?: string },
) {
  const existing = useContext(AuthContext);
  const actor = existing.session?.user.id ?? actorId;
  const session = useMemo(
    () =>
      existing.session ?? (actor
        ? {
          user: { id: actor },
          access_token: "isolated-browser-fixture",
        } as Session
        : null),
    [existing.session, actor],
  );
  const readSession = useMemo(
    () => async () => ({
      data: {
        session: session
          ? {
            user: { id: session.user.id },
            access_token: "isolated-browser-fixture",
          }
          : null,
      },
    }),
    [session],
  );
  return (
    <AuthContext.Provider value={{ ...existing, session }}>
      <ApiSessionContext.Provider value={readSession}>
        <WorkspaceRouteContext.Provider value={fixtureWorkspaceId}>
          <WorkspacePathPrefixContext.Provider value={false}>
            <WorkspaceCapabilitiesContext.Provider value={{ workspace: { id: fixtureWorkspaceId, name: "테스트 공간", deleted_at: null }, grants: [{ target_kind: "settings", target_id: "*", access: "write" }], can_manage: true, membership_version: 1 }}>{children}</WorkspaceCapabilitiesContext.Provider>
          </WorkspacePathPrefixContext.Provider>
        </WorkspaceRouteContext.Provider>
      </ApiSessionContext.Provider>
    </AuthContext.Provider>
  );
}
