import { useRecordAccess } from "./record-access.ts";
import { WorkspacePermissionNotice } from "../workspaces/WorkspacePermissionNotice.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { Button } from "@/components/ui/button";
import { useDetailResource } from "../details/useDetailResource.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { RecordRelations } from "./RecordRelations.tsx";
import { useDetailDeleteReturn, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { type WorkspaceRecord } from "./ChangeContext.tsx";
// 기록 상세: 원문 읽기, 편집, 삭제.
import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "../../lib/workspace-router.tsx";
import { Notice } from "../../components/Field.tsx";
import { RecordDataFields } from "./RecordDataFields.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { ApiError, query } from "../../lib/api.ts";
import { recordDraftFrom, RecordFormModal } from "./forms.tsx";
import { TagConnections } from "../tags/TagConnections.tsx";
import { recordDisplayText } from "@contracts/record-display.ts";

export function RecordDetailPage() {
  const api = useApi();
  const location = useLocation();
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back = useDetailOwnerReturn(
    `/records${query({ tag_id: params.get("tag_id") ?? "", entity_id: params.get("entity_id") ?? "" })}`,
  );
  const deleteBack = useDetailDeleteReturn(back);
  const navigate = useDetailNavigate();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const directEdit = params.get("edit") === "1";
  const [busy, setBusy] = useState(false);

  const detail = useDetailResource<WorkspaceRecord>({
    id,
    query: params.toString(),
    refreshOnQuery: directEdit,
    load: (id, signal) => api("GET", `/records/${id}`, undefined, signal),
  });
  const editor = useDetailEditor(detail.editClosed);
  const { value: record, editReady } = detail;
  const { canRead, canWrite } = useRecordAccess(record);
  const admittedEdit = useRef<{ api: typeof api; id: string; key: string } | null>(null);
  const editing = editor.active && editReady && (canWrite ||
    admittedEdit.current?.api === api && admittedEdit.current.id === id && admittedEdit.current.key === location.key);
  useLayoutEffect(() => {
    if (!editor.active || admittedEdit.current?.api !== api || admittedEdit.current.id !== id ||
      admittedEdit.current.key !== location.key) admittedEdit.current = null;
    if (editor.active && editReady && canWrite) admittedEdit.current = { api, id, key: location.key };
  }, [api, id, location.key, editor.active, editReady, canWrite]);
  const loadError = detail.error
    ? detail.error instanceof ApiError && detail.error.code === "not_found"
      ? "기록을 찾을 수 없습니다."
      : "기록을 불러오지 못했습니다."
    : null;
  const reload = detail.reload;

  if (loadError && !record) {
    return (
      <DetailSurface
        ready={!detail.loading}
        title="기록"
        description="기록 내용을 읽고 수정하며, 연결된 업무를 확인합니다."
        onClose={() => navigate(back)}
      >
        <Notice kind="error">{loadError}</Notice>
        <Button variant="outline" type="button" onClick={reload}>조회 다시 시도</Button>
      </DetailSurface>
    );
  }
  if (!record) return <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>;

  const management = (
    <div className="flex min-w-0 flex-col gap-5">
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <RecordDataFields record={record} />
      {loadError && (
        <>
          <Notice kind="error">{loadError}</Notice>
          <Button variant="outline" type="button" onClick={reload}>조회 다시 시도</Button>
        </>
      )}
      <TagConnections
        onDraftClosed={detail.editClosed}
        scope="record"
        target={record}
        readonly={!canWrite || record.record_kind === "change"}
        visible={canRead}
        onSaved={(saved) => detail.confirm((current) => current ? { ...current, ...saved } : current)}
      />
    </div>
  );
  return (
    <>
      {!canRead && <WorkspacePermissionNotice />}
      <DetailSurface
        ready={!detail.loading}
        visible={canRead}
        onError={detail.failed}
        footer={canWrite && <Button variant="default" type="button" onClick={editor.start}>편집</Button>}
        title="기록"
        description="기록 내용을 읽고 수정하며, 연결된 업무를 확인합니다."
        tabTitle={canRead ? recordDisplayText(record.body) : "기록"}
        onClose={() => navigate(back)}
        busy={busy}
      >
        <div className="flex min-w-0 flex-col gap-6">
          {management}
          <div className="flex min-w-0 flex-col gap-6">
            <RecordRelations record={record} />
          </div>
        </div>
        {editing && (
          <RecordFormModal
            record={record}
            visible={canRead}
            readonly={!canWrite}
            details={
              <div className="flex min-w-0 flex-col gap-6">
                <RecordRelations readOnly record={record} />
              </div>
            }
            editing
            systemRecord={record.record_kind === "change"}
            title="기록 편집"
            submitLabel="저장"
            open
            initial={recordDraftFrom(record, timezone)}
            deletion={!canWrite ? undefined : {
              target: recordDisplayText(record.body),
              note: false,
              message: (
                <p>
                  이 기록을 삭제합니다. {record.record_kind === "change"
                    ? "대상의 업무 상태는 되돌리지 않습니다."
                    : "일회성 할 일의 결과였다면 할 일은 완료 상태로 남고 결과 연결만 사라집니다."}
                </p>
              ),
              onConfirm: async (_reason, _tags, requestKey) => {
                setBusy(true);
                setError(null);
                try {
                  await api(
                    "DELETE",
                    `/records/${record.id}${
                      query({
                        expected_version: record.version,
                      })
                    }`,
                    undefined,
                    undefined,
                    requestKey(),
                  );
                  editor.leave(deleteBack);
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : "삭제하지 못했습니다.");
                  throw e;
                } finally {
                  setBusy(false);
                }
              },
            }}
            {...editor.formProps}
            onSave={async (value, requestKey) => {
              await detail.save(() =>
                api<WorkspaceRecord>(
                  "PATCH",
                  `/records/${record.id}`,
                  {
                    ...value,
                    expected_version: record.version,
                  },
                  undefined,
                  requestKey(),
                )
              );
              editor.close();
              setMessage("저장했습니다.");
            }}
          />
        )}
      </DetailSurface>
    </>
  );
}
