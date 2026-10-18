import { useEffect, useState } from "react";
import type { Workspace, WorkspaceLifecycle } from "@contracts/workspace.ts";
import { ApiError } from "../../lib/api.ts";
import { useApi } from "../../lib/api-context.tsx";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Alert, AlertDescription } from "../../components/ui/alert.tsx";
import { Button } from "../../components/ui/button.tsx";
import { BusinessCell, BusinessRow, BusinessTable } from "../../components/BusinessTable.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";

export type WorkspaceLifecycleIntent = { workspace: Workspace; action: "delete" | "restore" | "leave" };

/** Outside the active-business gate: deletion must not unmount its own unknown-response retry. */
export function WorkspaceLifecycleDialog({ intent, onClose, onSaved }: {
  intent: WorkspaceLifecycleIntent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [prepared, setPrepared] = useState<
    { workspace: Workspace; input: { expected_generation: number } | { expected_version: number } } | null
  >(null);
  const [authorized, setAuthorized] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt<{ workspace: WorkspaceLifecycle } | { left: true }>();
  usePageNavigationBlocker(false, busy);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = intent.action === "leave"
          ? await api<{ workspace: Workspace; membership_version: number }>(
            "GET",
            `/workspaces/${intent.workspace.id}/membership`,
            undefined,
            controller.signal,
          )
          : await api<{ workspace: WorkspaceLifecycle }>(
            "GET",
            `/workspaces/${intent.workspace.id}/lifecycle`,
            undefined,
            controller.signal,
          );
        if (controller.signal.aborted) return;
        setAuthorized(true);
        // A fresh projection confirms authority but never rewrites an unresolved
        // operation's original version, target or payload.
        if (!attempt.snapshot().uncertain && !attempt.snapshot().busy) {
          setPrepared({
            workspace: value.workspace,
            input: "membership_version" in value
              ? { expected_version: value.membership_version }
              : { expected_generation: value.workspace.lifecycle_generation },
          });
          setError("");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && (error.code === "forbidden" || error.code === "unauthenticated")) {
          setAuthorized(false);
        }
        setError(writeErrorMessage(error));
      }
    };
    void load();
    return () => controller.abort();
  }, [api, intent.workspace.id, intent.action, revision, attempt]);
  const stateMatches = prepared &&
    (intent.action === "leave" || intent.action === "delete" && !prepared.workspace.deleted_at ||
      intent.action === "restore" && !!prepared.workspace.deleted_at);
  const submit = async () => {
    if (!prepared || !authorized || !stateMatches || busy) return;
    try {
      const result = await attempt.run(() =>
        api<{ workspace: WorkspaceLifecycle } | { left: true }>(
          intent.action === "delete" ? "DELETE" : "POST",
          `/workspaces/${prepared.workspace.id}${intent.action === "delete" ? "" : `/${intent.action}`}`,
          prepared.input,
          undefined,
          attempt.requestKey(),
        )
      );
      if (result) onSaved();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "forbidden" || error.code === "unauthenticated")) {
        setAuthorized(false);
      } else if (!attempt.snapshot().uncertain) setPrepared(null);
      setError(writeErrorMessage(error));
    }
  };
  return (
    <ConfirmDialog
      open
      title={intent.action === "delete"
        ? "이 공간을 삭제할까요?"
        : intent.action === "restore"
        ? "이 공간을 복원할까요?"
        : "이 공간에서 탈퇴할까요?"}
      message={
        <div className="flex min-w-0 flex-col gap-3">
          <p className="break-words font-medium">{intent.workspace.name}</p>
          <p>
            {intent.action === "delete"
              ? "공동 데이터와 참여 권한은 보존됩니다. 삭제 동안 모든 참여자의 업무 접근이 중단되며, 관리자는 내 공간에서 복원할 수 있습니다."
              : intent.action === "restore"
              ? "기존 공동 데이터와 참여 권한으로 공간을 다시 엽니다. 삭제 전에 진행하던 작업은 자동으로 재시작하지 않습니다."
              : "공동 데이터는 보존되지만 이 공간에 다시 접근하거나 복원할 수 없습니다. 다른 관리자가 없다면 복원할 사람이 남지 않습니다."}
          </p>
          {!prepared && !error && (
            <p role="status" className="flex items-center gap-2">
              <Spinner />현재 권한과 참여 상태를 확인하는 중…
            </p>
          )}
          {prepared && !stateMatches && (
            <Alert>
              <AlertDescription>
                공간 상태가 변경되어 이 작업을 실행할 수 없습니다. 창을 닫고 현재 목록을 확인하세요.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {uncertain && !authorized && (
            <Alert>
              <AlertDescription>
                이전 요청의 결과는 확인되지 않았습니다. 현재 참여 또는 관리 권한을 확인할 수 없어 요청을 다시 실행하지
                않습니다.
              </AlertDescription>
            </Alert>
          )}
          {error && (!uncertain || !authorized) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRevision((value) => value + 1)}
            >
              현재 상태 다시 조회
            </Button>
          )}
        </div>
      }
      confirmLabel={uncertain
        ? "같은 요청 다시 확인"
        : intent.action === "delete"
        ? "공간 삭제"
        : intent.action === "restore"
        ? "공간 복원"
        : "공간 탈퇴"}
      danger={intent.action !== "restore"}
      busy={busy}
      confirmDisabled={!prepared || !authorized || !stateMatches}
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
  { revision, onRestore, onLeave }: {
    revision: number;
    onRestore: (workspace: WorkspaceLifecycle) => void;
    onLeave: (workspace: WorkspaceLifecycle) => void;
  },
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
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => onRestore(workspace)}>복원</Button>
                    <Button variant="outline" onClick={() => onLeave(workspace)}>탈퇴</Button>
                  </div>
                </BusinessCell>
              </BusinessRow>
            ))}
          </BusinessTable>
        )}
    </section>
  );
}
