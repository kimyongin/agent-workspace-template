import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Link } from "react-router";
export const WorkspaceCapabilitiesContext = createContext<WorkspaceCapabilities | null>(null);
export const useWorkspaceCapabilities = () => useContext(WorkspaceCapabilitiesContext);
const WorkspaceLoadContext = createContext<{
  error: string;
  retry: () => void;
  refresh: () => Promise<boolean>;
} | null>(null);
/** Refresh the shell's server snapshot after a confirmed membership change in this workspace. */
export const useRefreshWorkspaceCapabilities = () => useContext(WorkspaceLoadContext)?.refresh;
/** One current capability snapshot is shared by the shell and its gated business content. */
export function WorkspaceCapabilitiesProvider({ children }: { children: ReactNode }) {
  const api = useApi(), { actorId, workspaceId } = useRequestScope();
  const scope = actorId && workspaceId ? `${actorId}:${workspaceId}` : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; value: WorkspaceCapabilities } | null>(null),
    [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const pending = useRef<{
    scope: string;
    controller: AbortController;
    promise: Promise<boolean>;
  } | null>(null);
  const value = snapshot?.scope === scope ? snapshot.value : null;
  const error = failure?.scope === scope ? failure.message : "";
  const read = useCallback((replace = false): Promise<boolean> => {
    if (!actorId || !workspaceId || !scope) {
      pending.current?.controller.abort();
      pending.current = null;
      setSnapshot(null);
      setFailure(null);
      return Promise.resolve(false);
    }
    // Focus/retry joins the current read. A confirmed membership change starts
    // a fresh read so a response captured before the write cannot verify it.
    if (!replace && pending.current?.scope === scope) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const operation = { scope, controller, promise: Promise.resolve(false) };
    pending.current = operation;
    setFailure(null);
    operation.promise = api<WorkspaceCapabilities>(
      "GET",
      `/workspaces/${workspaceId}`,
      undefined,
      controller.signal,
    ).then((next) => {
      if (next.workspace.id !== workspaceId) throw new Error("현재 공간의 권한을 확인하지 못했습니다.");
      if (controller.signal.aborted) return false;
      setSnapshot({ scope, value: next });
      return true;
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setFailure({ scope, message: error instanceof Error ? error.message : "공간을 불러오지 못했습니다." });
      }
      return false;
    }).finally(() => {
      if (pending.current === operation) pending.current = null;
    });
    return operation.promise;
  }, [api, actorId, workspaceId, scope]);
  useEffect(() => {
    void read();
    return () => {
      if (pending.current?.scope === scope) {
        pending.current.controller.abort();
        pending.current = null;
      }
    };
  }, [read, scope]);
  useEffect(() => {
    if (!scope) return;
    const refresh = () => { void read(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [scope, read]);
  return <WorkspaceLoadContext.Provider value={{ error, retry: () => { void read(); }, refresh: () => read(true) }}>
    <WorkspaceCapabilitiesContext.Provider value={value}>{children}</WorkspaceCapabilitiesContext.Provider>
  </WorkspaceLoadContext.Provider>;
}
/** A route is usable only after current membership is confirmed by the shared loader. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const value = useWorkspaceCapabilities(), load = useContext(WorkspaceLoadContext);
  const { workspaceId } = useRequestScope();
  if (!load) throw new Error("WorkspaceGate requires WorkspaceCapabilitiesProvider");
  if (load.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{load.error}</AlertDescription>
        <Button
          variant="outline"
          onClick={load.retry}
        >
          다시 시도
        </Button>
        {workspaceId && (
          <Button asChild variant="outline">
            <Link to={`/workspaces?leave=${encodeURIComponent(workspaceId)}`}>참여 확인·탈퇴</Link>
          </Button>
        )}
      </Alert>
    );
  }
  if (!value) {
    return (
      <p role="status" className="flex items-center gap-2 p-4">
        <Spinner />공간을 확인하는 중…
      </p>
    );
  }
  return children;
}
