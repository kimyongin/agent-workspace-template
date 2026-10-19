import { useTaskAccess } from "./task-access.ts";
import { WorkspacePermissionNotice } from "../workspaces/WorkspacePermissionNotice.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useDetailResource } from "../details/useDetailResource.ts";

import { RelatedRecords } from "./RelatedRecords.tsx";
import { useDetailDeleteReturn, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { useRecordConfirmation } from "../../components/RecordConfirmation.tsx";
import { FormModal } from "../../components/ContentForm.tsx";
// 할 일 상세: 읽기, 편집, 일회성 완료, 반복 할 일의 회차·회차 기록·중단/재개, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import type { Occurrence, TaskDetail, TaskResult } from "@contracts/task.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "../../lib/workspace-router.tsx";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { TaskDataFields } from "./TaskDataFields.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { ApiError, query } from "../../lib/api.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { addDays, todayIn } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal, taskDraftFrom, TaskFormModal } from "./forms.tsx";
import { OccurrenceBadge } from "./shared.tsx";
import { TagConnections } from "../tags/TagConnections.tsx";
import { TaskEntityRelations } from "../entity/TaskEntityRelations.tsx";

type Dialog = null | "complete" | "transition" | "restore" | { occurrence: string };
function requestedDialog(params: URLSearchParams): Dialog {
  const action = params.get("action");
  return action === "complete" || action === "transition" || action === "restore"
    ? action
    : params.has("occurrence")
    ? { occurrence: params.get("occurrence")! }
    : null;
}

export function TaskDetailPage() {
  const api = useApi();
  const { canRead, canWrite } = useTaskAccess();
  const location = useLocation();
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back = useDetailOwnerReturn(
    `/tasks${
      query({
        kind: params.get("kind"),
        status: params.get("status"),
        tag_id: params.get("tag_id"),
        entity_id: params.get("entity_id"),
        deleted: params.get("deleted"),
      })
    }`,
  );
  const deleteBack = useDetailDeleteReturn(back);
  const navigate = useDetailNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const relationSaved = useRef(false);
  const directEdit = params.get("edit") === "1";
  const [dialog, setDialog] = useState<Dialog>(requestedDialog(params));
  const [transitionState, setTransitionState] = useState({ busy: false, uncertain: false });
  const transitionLocked = transitionState.busy || transitionState.uncertain;
  const manage = (action: string, occurrence?: string) => {
    if (transitionState.busy || transitionState.uncertain && action !== "transition") return;
    if (action === "transition") {
      setDialog("transition");
      if (transitionState.uncertain) return;
    }
    const next = new URLSearchParams(params);
    next.set("action", action);
    occurrence ? next.set("occurrence", occurrence) : next.delete("occurrence");
    navigate(`?${next}`);
  };
  const closeManagement = () => {
    setDialog(null);
    if (transitionState.uncertain) return;
    const next = new URLSearchParams(params);
    next.delete("action");
    next.delete("occurrence");
    navigateAfterClose(`?${next}`, true);
  };
  const [busy, setBusy] = useState(false);
  const [occurrences, setOccurrences] = useState<{ today: string; items: Occurrence[] } | null>(null);
  const [recordRefresh, setRecordRefresh] = useState(0);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  const detail = useDetailResource<TaskDetail>({
    id,
    query: params.toString(),
    refreshOnQuery: directEdit,
    load: (id, signal) => api("GET", `/tasks/${id}`, undefined, signal),
  });
  const editor = useDetailEditor(detail.editClosed);
  const { value: task, editReady } = detail;
  const admittedEdit = useRef<{ api: typeof api; id: string; key: string } | null>(null);
  const editing = editor.active && !dialog && editReady && (canWrite && !task?.deleted_at ||
    admittedEdit.current?.api === api && admittedEdit.current.id === id && admittedEdit.current.key === location.key);
  useLayoutEffect(() => {
    if (!editor.active || admittedEdit.current?.api !== api || admittedEdit.current.id !== id ||
      admittedEdit.current.key !== location.key) admittedEdit.current = null;
    if (editor.active && !dialog && editReady && canWrite && !task?.deleted_at) admittedEdit.current = { api, id, key: location.key };
  }, [api, id, location.key, editor.active, dialog, editReady, canWrite, task?.deleted_at]);

  const loadError = detail.error
    ? detail.error instanceof ApiError && detail.error.code === "not_found"
      ? "할 일을 찾을 수 없습니다."
      : "할 일을 불러오지 못했습니다."
    : null;
  const reload = detail.reload;
  useEffect(() => {
    if (!detail.confirmed && detail.value) relationSaved.current = false;
  }, [detail.value, detail.confirmed]);

  const occurrenceGeneration = useRef(0);
  useEffect(() => () => {
    occurrenceGeneration.current++;
  }, [api, id]);
  const loadOccurrences = useCallback(async (t: TaskResult, end: string | null) => {
    const started = ++occurrenceGeneration.current;
    try {
      // 할 일 시간대의 오늘 기준 앞 13일과 뒤 7일. 이전 기간으로 옮길 수 있다.
      const to = end ?? addDays(todayIn(t.timezone ?? "UTC"), 7);
      const from = addDays(to, -20);
      const res = await api<{ today: string; items: Occurrence[] }>(
        "GET",
        `/tasks/${t.id}/occurrences?from=${from}&to=${to}`,
      );
      if (started !== occurrenceGeneration.current) return;
      setOccurrences({ today: res.today, items: [...res.items].reverse() });
    } catch {
      if (started !== occurrenceGeneration.current) return;
      setOccurrences(null);
      setActionError("회차를 불러오지 못했습니다.");
    }
  }, [api]);

  useEffect(() => {
    if (task?.kind === "recurring") loadOccurrences(task, rangeEnd);
  }, [task, rangeEnd, loadOccurrences]);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "처리하지 못했습니다.");
      throw e;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setDialog(requestedDialog(params));
  }, [id, params.toString()]);

  if (loadError && !task) {
    return (
      <DetailSurface
        ready={!detail.loading}
        title="할 일"
        description="일정과 진행 상태를 확인하고, 수행 결과를 기록합니다."
        onClose={() => navigate(back)}
      >
        <Notice kind="error">{loadError}</Notice>
        <Button variant="outline" type="button" onClick={reload}>조회 다시 시도</Button>
      </DetailSurface>
    );
  }
  if (!task) return <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>;

  const management = (
    <div className="flex min-w-0 flex-col gap-5">
      <section className="flex min-w-0 flex-col gap-4">
        {message && <Notice kind="success">{message}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        {loadError && (
          <>
            <Notice kind="error">
              {relationSaved.current
                ? "연결은 저장했습니다. 최신 내용을 불러오지 못했습니다."
                : message
                ? "저장은 완료했습니다. 최신 내용을 불러오지 못했습니다."
                : loadError}
            </Notice>
            <Button variant="outline" type="button" onClick={reload}>조회 다시 시도</Button>
          </>
        )}
        {task.deleted_at && <Notice>삭제된 할 일입니다. 내용과 결과·회차 기록은 보존되어 있습니다.</Notice>}
        <TaskDataFields task={task} />
        <TagConnections
          onDraftClosed={detail.editClosed}
          scope="task"
          target={task}
          readonly={!canWrite || !!task.deleted_at || transitionLocked}
          visible={canRead}
          onSaved={(saved) => detail.confirm((current) => current ? { ...current, ...saved } : current)}
        />
        {task.kind === "once" && task.status === "done" && !task.result_record && (
          <p className="text-sm text-muted-foreground">결과 기록이 삭제되었습니다.</p>
        )}
      </section>
    </div>
  );
  const occurrenceSection = (readOnly = false) => (
    <>
      {task.kind === "recurring" && (
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby={readOnly ? "occ-edit-title" : "occ-title"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={readOnly ? "occ-edit-title" : "occ-title"} className="text-base font-semibold">회차</h2>
            {occurrences && !readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setRangeEnd(addDays(occurrences.items.at(-1)?.date ?? occurrences.today, -1))}
                >
                  이전 기간
                </Button>
                {rangeEnd && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setRangeEnd(null)}
                  >
                    최근으로
                  </Button>
                )}
              </div>
            )}
          </div>
          {task.status === "stopped" && <Notice>중단된 할 일입니다. 재개하면 그날부터 회차가 생깁니다.</Notice>}
          {!occurrences && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
          {occurrences?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">이 기간에는 회차가 없습니다.</p>
          )}
          {occurrences && occurrences.items.length > 0 && (
            <BusinessTable label="반복 할 일 회차 목록" columns={["회차", "상태", "기록", "조작"]} disclosureColumn={false}>
              {occurrences.items.map((o) => (
                <BusinessRow key={o.date}>
                  <BusinessCell index={0}>
                    <span>
                      {o.date}
                      {o.date === occurrences.today ? " (오늘)" : ""}
                    </span>
                    {!o.in_rule && <span className="text-sm text-muted-foreground">규칙 밖 기록</span>}

                  </BusinessCell>
                  <BusinessCell index={1}><OccurrenceBadge status={o.status} /></BusinessCell>
                  <BusinessCell index={2}>{o.record_ids.length > 0 ? `기록 ${o.record_ids.length}개` : "기록 없음"}</BusinessCell>
                  <BusinessCell index={3}>
                  {!readOnly && canWrite && !task.deleted_at && o.in_rule && o.status !== "upcoming" && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => manage("occurrence", o.date)}
                      aria-label={`${o.date} 회차 기록`}
                    >
                      기록
                    </Button>
                  )}
                  </BusinessCell>
                </BusinessRow>
              ))}
            </BusinessTable>
          )}
        </section>
      )}
    </>
  );
  return (
    <>
      {!canRead && <WorkspacePermissionNotice />}
      <DetailSurface
        visible={canRead}
        ready={!detail.loading}
        title="할 일"
        description="일정과 진행 상태를 확인하고, 수행 결과를 기록합니다."
        tabTitle={canRead ? task.title : "할 일"}
        onClose={() => navigate(back)}
        onError={detail.failed}
        busy={busy || transitionState.busy || transitionState.uncertain && canWrite}
        footer={canWrite && (
          task.deleted_at ? <Button type="button" disabled={busy || transitionLocked} onClick={() => manage("restore")}>복원</Button> : <>
            <Button variant="outline" type="button" disabled={busy || transitionLocked} onClick={editor.start}>편집</Button>
            {task.kind === "once" && task.status === "open" && (
              <Button
                variant="default"
                type="button"
                disabled={busy || transitionLocked}
                onClick={() => manage("complete")}
              >
                완료하고 기록
              </Button>
            )}
            {task.kind === "recurring" && (
              <Button
                variant="default"
                type="button"
                disabled={busy || transitionState.busy}
                onClick={() => manage("transition")}
              >
                {task.status === "active" ? "중단" : "재개"}
              </Button>
            )}
          </>
        )}
      >
        <div className="flex min-w-0 flex-col gap-6">
          {management}
          <div className="flex min-w-0 flex-col gap-6">
            <TaskEntityRelations
              readOnly={transitionLocked}
              task={task}
              onSaved={(saved, before) => {
                if (before) relationSaved.current = true;
                if (saved) detail.confirm((current) => current ? { ...current, ...saved } : current);
                setRecordRefresh((n) => n + 1);
                void reload();
              }}
            />
            <RelatedRecords
              taskId={task.id}
              revision={task.version + recordRefresh}

            />
            {occurrenceSection(transitionLocked)}
          </div>
        </div>
        {editing && (
          <TaskFormModal
            mode="edit"
            target={task}
            open
            initial={taskDraftFrom(task, timezone)}
            details={
              <>
                {task.kind === "once" && task.status === "done" && !task.result_record && (
                  <p className="text-sm text-muted-foreground">결과 기록이 삭제되었습니다.</p>
                )}
                <div className="flex min-w-0 flex-col gap-6">
                  <TaskEntityRelations readOnly task={task} onSaved={() => {}} />
                  <RelatedRecords readOnly taskId={task.id} revision={task.version + recordRefresh} />
                  {occurrenceSection(true)}
                </div>
              </>
            }
            deletion={!canWrite || task.deleted_at ? undefined : {
              target: task.title,
              preparation: () => ({
                model: "task",
                action: "delete",
                target_id: task.id,
                expected_version: task.version,
                input: {},
              }),
              message: (
                <p>
                  이 할 일을 삭제 상태로 보관합니다. 내용과 결과·회차 기록, 기존 연결은 유지합니다.
                </p>
              ),
              onConfirm: (reason, tags, requestKey) =>
                run(async () => {
                  await api(
                    "POST",
                    `/tasks/${task.id}/delete`,
                    { expected_version: task.version, change_note: reason, change_tag_ids: tags },
                    undefined,
                    requestKey(),
                  );
                  editor.leave(deleteBack);
                }, "삭제했습니다."),
            }}
            {...editor.formProps}
            onSave={async (save) => {
              await detail.save(async (current) => ({ ...current, ...await save() }));
              editor.close();
              setMessage("저장했습니다.");
              await reload();
            }}
          />
        )}
        {dialog === "restore" && (
          <TaskRestoreForm
            key={task.id}
            task={task}
            onClose={closeManagement}
            onSaved={async (saved) => {
              detail.confirm(current => current ? { ...current, ...saved } : current);
              closeManagement();
              setMessage("복원했습니다.");
              await reload();
            }}
          />
        )}
        {task.kind === "recurring" && (
          <TaskTransitionForm
            key={task.id}
            open={dialog === "transition"}
            task={task}
            onState={setTransitionState}
            onClose={closeManagement}
            onSaved={async () => {
              closeManagement();
              setMessage(task.status === "active" ? "중단했습니다. 오늘부터 회차가 없습니다." : "재개했습니다.");
              await reload();
            }}
          />
        )}
        {dialog === "complete" && (
          <RecordFormModal
            title="할 일 완료"
            visible={canRead}
            readonly={!canWrite || !!task.deleted_at}
            submitLabel="완료하고 기록 저장"
            open
            initial={emptyRecord()}
            onClose={closeManagement}
            onRouteDiscard={() => setDialog(null)}
            onSave={async (value, requestKey) => {
              await api(
                "POST",
                `/tasks/${task.id}/complete`,
                { ...value, expected_version: task.version },
                undefined,
                requestKey(),
              );
              closeManagement();
              setMessage("완료하고 결과 기록을 저장했습니다.");
              await reload();
            }}
          />
        )}
        {dialog && typeof dialog === "object" && (
          <RecordFormModal
            title={`${dialog.occurrence} 회차 기록`}
            visible={canRead}
            readonly={!canWrite || !!task.deleted_at}
            submitLabel="기록 저장"
            open
            initial={emptyRecord()}
            onClose={closeManagement}
            onRouteDiscard={() => setDialog(null)}
            onSave={async (value, requestKey) => {
              await api<RecordResult>(
                "POST",
                `/tasks/${task.id}/occurrences/${dialog.occurrence}/records`,
                {
                  ...value,
                },
                undefined,
                requestKey(),
              );
              closeManagement();
              setMessage(`${dialog.occurrence} 회차에 기록했습니다.`);
              setRecordRefresh((n) => n + 1);
              await loadOccurrences(task, rangeEnd);
            }}
          />
        )}
      </DetailSurface>
    </>
  );
}

type TransitionState = { busy: boolean; uncertain: boolean };
function TaskTransitionForm(
  { task, open, onClose, onSaved, onState }: {
    task: TaskResult;
    open: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onState: (state: TransitionState) => void;
  },
) {
  const [session, setSession] = useState<{ target: TaskResult; generation: number; completed: boolean } | null>(null);
  useLayoutEffect(() => {
    // Capture the optimistic target at first opening, then keep the attempt across view dismissal.
    if (open && (!session || session.completed)) {
      setSession({ target: task, generation: (session?.generation ?? 0) + 1, completed: false });
    }
  }, [open, session, task]);
  return session && <TaskTransitionSession
    key={session.generation}
    target={session.target}
    task={task}
    open={open && !session.completed}
    onClose={onClose}
    onState={onState}
    onSaved={async () => {
      await onSaved();
      setSession(current => current?.generation === session.generation ? { ...current, completed: true } : current);
    }}
  />;
}
function TaskTransitionSession(
  { target, task, open, onClose, onSaved, onState }: {
    target: TaskResult;
    task: TaskResult;
    open: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onState: (state: TransitionState) => void;
  },
) {
  const api = useApi();
  const { canRead, canWrite } = useTaskAccess();
  const [owner] = useState(() => api);
  const active = owner === api;
  const current = useRef({ api, task, canWrite, onSaved });
  current.current = { api, task, canWrite, onSaved };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const action = target.status === "active" ? "stop" : "resume", label = action === "stop" ? "중단" : "재개";
  const confirmation = useRecordConfirmation({
    open, visible: active && canRead, disabled: !active || !canWrite || !!task.deleted_at,
    initial: "save", retainOnCancel: true, onCancel: onClose,
    describe: () => ({
      title: `${label}하시겠습니까?`, label: `${label}하고 저장`, defaultNote: `${target.title} ${label}`,
      preparation: () => ({ model: "task", action, target_id: target.id, expected_version: target.version, input: {} }),
      record: true,
      data: [{ label: "대상", value: target.title, fullWidth: true }, { label: "작업", value: label }],
      message: action === "stop"
        ? "오늘부터 이후 회차가 생기지 않고 기존 기록은 남습니다."
        : "오늘부터 규칙에 따라 회차가 다시 생깁니다.",
      execute: async (requestKey, memo) => {
        const latest = current.current;
        if (latest.api !== owner || latest.task.id !== target.id || !latest.canWrite || latest.task.deleted_at) {
          throw new Error("이 할 일을 현재 변경할 수 없습니다.");
        }
        await owner("POST", `/tasks/${target.id}/${action}`, { expected_version: target.version, ...memo }, undefined, requestKey());
        if (alive.current && current.current.api === owner && current.current.task.id === target.id) await current.current.onSaved();
      },
    }),
  });
  useLayoutEffect(() => {
    onState({ busy: confirmation.busy, uncertain: confirmation.uncertain });
  }, [onState, confirmation.busy, confirmation.uncertain]);
  useLayoutEffect(() => () => onState({ busy: false, uncertain: false }), [onState]);
  return null;
}

function TaskRestoreForm({ task, onClose, onSaved }: {
  task: TaskResult;
  onClose: () => void;
  onSaved: (saved: TaskResult) => Promise<void>;
}) {
  const api = useApi();
  const { canRead, canWrite } = useTaskAccess();
  const [owner] = useState(() => api);
  const [target] = useState(task);
  const active = owner === api;
  return <FormModal
    open
    visible={active && canRead}
    submitDisabled={!active || !canWrite || !target.deleted_at}
    title="할 일 복원"
    submitLabel="복원"
    dirty={false}
    confirmationOnly
    preparation={() => ({ model: "task", action: "restore", target_id: target.id, expected_version: target.version, input: {} })}
    mutation={{ target: target.title, action: "복원", message: "같은 할 일을 복원합니다. 보관된 내용과 결과·회차 기록, 기존 연결을 유지합니다." }}
    onClose={onClose}
    onRouteDiscard={onClose}
    validate={() => null}
    onSubmit={async (requestKey, memo) => {
      if (!active || !canWrite || !target.deleted_at) throw new Error("이 할 일을 현재 복원할 수 없습니다.");
      const saved = await api<TaskResult>("POST", `/tasks/${target.id}/restore`, { expected_version: target.version, ...memo }, undefined, requestKey());
      await onSaved(saved);
    }}
  >{() => null}</FormModal>;
}
