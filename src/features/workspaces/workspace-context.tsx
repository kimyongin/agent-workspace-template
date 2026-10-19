import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Link } from "react-router";
export const WorkspaceCapabilitiesContext = createContext<WorkspaceCapabilities | null>(null);
export const useWorkspaceCapabilities = () => useContext(WorkspaceCapabilitiesContext);
const WorkspaceLoadContext = createContext<{ error: string; retry: () => void } | null>(null);
/** One current capability snapshot is shared by the shell and its gated business content. */
export function WorkspaceCapabilitiesProvider({ children }: { children: ReactNode }) {
  const api = useApi(), { actorId, workspaceId } = useRequestScope();
  const scope = actorId && workspaceId ? `${actorId}:${workspaceId}` : null;
  const [snapshot, setSnapshot] = useState<{ scope: string; value: WorkspaceCapabilities } | null>(null),
    [failure, setFailure] = useState<{ scope: string; message: string } | null>(null),
    [revision, setRevision] = useState(0);
  const value = snapshot?.scope === scope ? snapshot.value : null;
  const error = failure?.scope === scope ? failure.message : "";
  useEffect(() => {
    const controller = new AbortController();
    setFailure(null);
    if (!actorId || !workspaceId || !scope) {
      setSnapshot(null);
      return () => controller.abort();
    }
    void api<WorkspaceCapabilities>(
      "GET",
      `/workspaces/${workspaceId}`,
      undefined,
      controller.signal,
    ).then((next) => {
      if (next.workspace.id !== workspaceId) throw new Error("현재 공간의 권한을 확인하지 못했습니다.");
      if (!controller.signal.aborted) setSnapshot({ scope, value: next });
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setFailure({ scope, message: error instanceof Error ? error.message : "공간을 불러오지 못했습니다." });
      }
    });
    return () => controller.abort();
  }, [api, actorId, workspaceId, scope, revision]);
  useEffect(() => {
    if (!scope) return;
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [scope]);
  return <WorkspaceLoadContext.Provider value={{ error, retry: () => setRevision((value) => value + 1) }}>
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
