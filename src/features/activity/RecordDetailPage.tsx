import { useDetailResource } from "../details/useDetailResource.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { RecordRelations } from "./RecordRelations.tsx";
import { useDetailNavigate, useDetailOwnerReturn, useDetailDeleteReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { ChangeContext, type WorkspaceRecord } from "./ChangeContext.tsx";
// 기록 상세: 원문 읽기, 편집, 삭제.
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { RecordFormModal, recordDraftFrom } from "./forms.tsx";
import { TagConnections } from "../tags/TagConnections.tsx";
import { recordDisplayText } from "@contracts/record-display.ts";

export function RecordDetailPage() {
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useDetailOwnerReturn(`/records${query({tag_id:params.get("tag_id")??"",entity_id:params.get("entity_id")??""})}`);
  const deleteBack=useDetailDeleteReturn(back);
  const navigate = useDetailNavigate();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const directEdit = params.get("edit") === "1";
  const [busy, setBusy] = useState(false);

  const detail = useDetailResource<WorkspaceRecord>({
    id, query: params.toString(), refreshOnQuery: directEdit,
    load: (id, signal) => api("GET", `/records/${id}`, undefined, signal),
  });
  const editor = useDetailEditor(detail.editClosed);
  const { value: record, editReady } = detail;
  const loadError = detail.error ? detail.error instanceof ApiError && detail.error.code === "not_found" ? "기록을 찾을 수 없습니다." : "기록을 불러오지 못했습니다." : null;
  const reload = detail.reload;


  if (loadError && !record) {
    return (
      <DetailSurface title="기록" description="기록 내용을 읽고 수정하며, 연결된 업무를 확인합니다." onClose={()=>navigate(back)}>
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn" onClick={reload}>조회 다시 시도</button>
      </DetailSurface>
    );
  }
  if (!record) return <p className="secondary" role="status">불러오는 중…</p>;

  const management = <div className="detail-management">

      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <ChangeContext record={record}/>
      {loadError && <><Notice kind="error">{loadError}</Notice><button type="button" className="btn" onClick={reload}>조회 다시 시도</button></>}
      <TagConnections onDraftClosed={detail.editClosed} scope="record" target={record} readonly={record.record_kind === "change"} onSaved={(saved) => detail.confirm((current) => current ? { ...current, ...saved } : current)} />

    </div>;
  return <DetailSurface footer={<button type="button" className="btn btn-primary" onClick={editor.start}>편집</button>} title="기록" description="기록 내용을 읽고 수정하며, 연결된 업무를 확인합니다." tabTitle={recordDisplayText(record.body)} onClose={()=>navigate(back)} busy={busy}>

      <div className="detail-stack">{record.body&&<section className="detail-section record-content" aria-label="내용"><MarkdownContent text={record.body}/></section>}
      {management}
      <div className="detail-relations"><RecordRelations record={record}/></div></div>
      {editor.active && editReady && (
        <RecordFormModal
          editing systemRecord={record.record_kind==="change"}
          title="기록 편집"
          submitLabel="저장"
          open
          initial={recordDraftFrom(record, timezone)}
          deletion={{message:<p style={{ margin: 0 }}>
            이 기록을 삭제합니다. {record.record_kind==="change"?"대상의 업무 상태는 되돌리지 않습니다.":"일회성 할 일의 결과였다면 할 일은 완료 상태로 남고 결과 연결만 사라집니다."}
          </p>,onConfirm:async (reason,tags,requestKey) => {
          setBusy(true);
          setError(null);
          try {
            await api("DELETE", `/records/${record.id}${query({expected_version:record.version, change_note:reason || undefined, change_tag_ids:tags?.length ? tags.join(",") : undefined})}`, undefined, undefined, requestKey());
            editor.leave(deleteBack);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "삭제하지 못했습니다.");
            throw e;
          } finally {
            setBusy(false);
          }
        }}}
          {...editor.formProps}
          onSave={async (value,requestKey) => {
            await detail.save(() => api<WorkspaceRecord>("PATCH", `/records/${record.id}`, {
              ...value, expected_version: record.version,
            }, undefined, requestKey()));
             editor.close();
            setMessage("저장했습니다.");
          }}
        />
      )}

    </DetailSurface>;
}
