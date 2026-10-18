import { useEffect, useState } from "react";
import type { Workspace, WorkspaceLifecycle } from "@contracts/workspace.ts";
import { useApi } from "../../lib/api-context.tsx";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import { BusinessCell, BusinessRow, BusinessTable } from "../../components/BusinessTable.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";

export type WorkspaceLifecycleIntent = { workspace: Workspace; action: "delete" | "restore" };

/** Outside the active-business gate: deletion must not unmount its own unknown-response retry. */
export function WorkspaceLifecycleDialog({ intent, onClose, onSaved }: {
  intent: WorkspaceLifecycleIntent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [workspace, setWorkspace] = useState<WorkspaceLifecycle | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt<{ workspace: WorkspaceLifecycle }>();
  usePageNavigationBlocker(false, busy);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ workspace: WorkspaceLifecycle }>(
      "GET",
      `/workspaces/${intent.workspace.id}/lifecycle`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setWorkspace(value.workspace);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(writeErrorMessage(error));
      });
    return () => controller.abort();
  }, [api, intent.workspace.id, revision]);
  const submit = async () => {
    if (!workspace || busy) return;
    try {
      const result = await attempt.run(() =>
        api<{ workspace: WorkspaceLifecycle }>(
          intent.action === "delete" ? "DELETE" : "POST",
          `/workspaces/${workspace.id}${intent.action === "restore" ? "/restore" : ""}`,
          { expected_generation: workspace.lifecycle_generation },
          undefined,
          attempt.requestKey(),
        )
      );
      if (result) onSaved();
    } catch (error) {
      setError(writeErrorMessage(error));
    }
  };
  return (
    <ConfirmDialog
      open
      title={intent.action === "delete" ? "이 공간을 삭제할까요?" : "이 공간을 복원할까요?"}
      message={
        <div className="flex min-w-0 flex-col gap-3">
          <p className="break-words font-medium">{intent.workspace.name}</p>
          <p>
            {intent.action === "delete"
              ? "공동 데이터와 참여 권한은 보존됩니다. 삭제 동안 모든 참여자의 업무 접근이 중단되며, 관리자는 내 공간에서 복원할 수 있습니다."
              : "기존 공동 데이터와 참여 권한으로 공간을 다시 엽니다. 삭제 전에 진행하던 작업은 자동으로 재시작하지 않습니다."}
          </p>
          {!workspace && !error && (
            <p role="status" className="flex items-center gap-2">
              <Spinner />현재 권한과 공간 상태를 확인하는 중…
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {error && !uncertain && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setWorkspace(null);
                setRevision((value) => value + 1);
              }}
            >
              현재 상태 다시 조회
            </Button>
          )}
        </div>
      }
      confirmLabel={uncertain ? "같은 요청 다시 확인" : intent.action === "delete" ? "공간 삭제" : "공간 복원"}
      danger={intent.action === "delete"}
      busy={busy}
      confirmDisabled={!workspace}
      onConfirm={() => {
        void submit();
      }}
      onCancel={() => {
        if (!busy) {
          attempt.startNewIntent();
          onClose();
        }
      }}
    />
  );
}

export function DeletedWorkspaces(
  { revision, onRestore }: { revision: number; onRestore: (workspace: WorkspaceLifecycle) => void },
) {
  const api = useApi();
  const [items, setItems] = useState<WorkspaceLifecycle[] | null>(null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: WorkspaceLifecycle[] }>("GET", "/workspaces/deleted", undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setItems(value.items);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(writeErrorMessage(error));
      });
    return () => controller.abort();
  }, [api, revision, retry]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="deleted-workspaces">
      <h2 id="deleted-workspaces" className="text-lg font-semibold">삭제한 공간</h2>
      <p className="text-muted-foreground">현재 관리 권한으로 복원할 수 있는 공간입니다.</p>
      {error
        ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>삭제한 공간 다시 불러오기</Button>
          </Alert>
        )
        : items === null
        ? (
          <p role="status" className="flex items-center gap-2">
            <Spinner />삭제한 공간을 불러오는 중…
          </p>
        )
        : !items.length
        ? <p className="text-muted-foreground">복원할 공간이 없습니다.</p>
        : (
          <BusinessTable label="삭제한 공간" columns={["공간", "작업"]} disclosureColumn={false}>
            {items.map((workspace) => (
              <BusinessRow key={workspace.id}>
                <BusinessCell index={0}>{workspace.name}</BusinessCell>
                <BusinessCell index={1}>
                  <Button variant="outline" onClick={() => onRestore(workspace)}>복원</Button>
                </BusinessCell>
              </BusinessRow>
            ))}
          </BusinessTable>
        )}
    </section>
  );
}
