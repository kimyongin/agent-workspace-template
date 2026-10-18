import { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { useWorkspaceId } from "./workspace-route.tsx";
import { AuthContext } from "../features/auth/auth-context.ts";
import {
  createScopedApi,
  type RequestScope,
  type SessionReader,
} from "./api.ts";

export const ApiSessionContext = createContext<SessionReader | undefined>(
  undefined,
);
export function useRequestScope(): RequestScope {
  const { session } = useContext(AuthContext);
  const workspaceId = useWorkspaceId();
  const actorId = session?.user.id ?? "";
  return useMemo(() => Object.freeze({ actorId, workspaceId }), [
    actorId,
    workspaceId,
  ]);
}
/** Every adapter and deferred callback retains its original account and route space. */
export function useApi() {
  const scope = useRequestScope();
  const sessionReader = useContext(ApiSessionContext);
  const lifetime = useMemo(() => ({ active: true }), [scope]);
  useLayoutEffect(() => {
    lifetime.active = true;
    return () => {
      lifetime.active = false;
    };
  }, [lifetime]);
  return useMemo(
    () => createScopedApi(scope, () => lifetime.active, sessionReader),
    [scope, lifetime, sessionReader],
  );
}
export function sameRequestScope(event: Event, scope: RequestScope) {
  const origin = (event as CustomEvent<RequestScope>).detail;
  return origin?.actorId === scope.actorId &&
    origin?.workspaceId === scope.workspaceId;
}
