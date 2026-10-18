import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { WorkspaceCapabilities } from "@contracts/workspace.ts";
import { useApi, useRequestScope } from "../../lib/api-context.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
export const WorkspaceCapabilitiesContext = createContext<WorkspaceCapabilities | null>(null);
export const useWorkspaceCapabilities = () => useContext(WorkspaceCapabilitiesContext);
/** A route is usable only after current membership is confirmed by the server. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const api = useApi(), { workspaceId } = useRequestScope();
  const [value, setValue] = useState<WorkspaceCapabilities | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void api<WorkspaceCapabilities>(
      "GET",
      `/workspaces/${workspaceId}`,
      undefined,
      controller.signal,
    ).then((next) => {
      if (!controller.signal.aborted) setValue(next);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setValue(null);
        setError(
          error instanceof Error
            ? error.message
            : "공간을 불러오지 못했습니다.",
        );
      }
    });
    return () => controller.abort();
  }, [api, workspaceId, revision]);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
        <Button
          variant="outline"
          onClick={() => setRevision((value) => value + 1)}
        >
          다시 시도
        </Button>
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
  return <WorkspaceCapabilitiesContext.Provider value={value}>{children}</WorkspaceCapabilitiesContext.Provider>;
}
