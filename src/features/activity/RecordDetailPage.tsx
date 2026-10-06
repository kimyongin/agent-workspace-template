import { DetailLink as Link, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { editFromView } from "../../lib/detail-navigation.ts";
import { ChangeContext, PrincipleSnapshots, type WorkspaceRecord } from "./ChangeContext.tsx";
// 기록 상세: 원문 읽기, 편집, 삭제.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { RecordFormModal, recordDraftFrom } from "./forms.tsx";
import {TagNames} from "../tags/TagPicker.tsx";
import {EntityLinks} from "../entity/EntityPicker.tsx";

export function RecordDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useDetailOwnerReturn(`/records${query({tag_id:params.get("tag_id")??"",entity_id:params.get("entity_id")??""})}`);
  const listPath = back;
  const navigate = useDetailNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const [record, setRecord] = useState<WorkspaceRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const directEdit = params.get("edit") === "1";
  const [dialog, setDialog] = useState<null | "edit" | "delete">(directEdit ? "edit" : null);
    const conflicted=useRef(false);
  const closeEdit = () => { setDialog(null);if(conflicted.current){conflicted.current=false;void reload();} if(directEdit&&params.get("edit_from")!=="view")navigateAfterClose(back,true);else{const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");navigateAfterClose(`?${p}`,true);} };
  const [editReady,setEditReady]=useState(false);
  const [busy, setBusy] = useState(false);

  const previousQuery = useRef(params.toString());
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const started = ++loadGeneration.current;
    try {
      const loaded = await api<WorkspaceRecord>("GET", `/records/${id}`);
      if(started !== loadGeneration.current)return;
      setRecord(loaded);
      setLoadError(null);setEditReady(true);
    } catch (e) {
      if(started !== loadGeneration.current)return;
      setLoadError(e instanceof ApiError && e.code === "not_found" ? "기록을 찾을 수 없습니다." : "기록을 불러오지 못했습니다.");
    }
  }, [id]);

  useEffect(() => {
    setRecord(null); setLoadError(null); setDialog(directEdit ? "edit" : null);
    reload();
    return () => {loadGeneration.current++;};
  }, [reload]);

  useEffect(()=>{
    const query=params.toString();
    if(previousQuery.current===query)return;
    previousQuery.current=query;
    setDialog(directEdit?"edit":null);
    if(directEdit){setEditReady(false);void reload();}
  },[params.toString(),reload]);

  if (loadError && !record) {
    return (
      <DetailSurface title="기록" onClose={()=>navigate(back)}>
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
      {record.task_id && <div><h2 className="section-title">관련 할 일</h2><Link to={`/tasks/${record.task_id}`}>{record.occurrence_on ? `${record.occurrence_on} 회차` : "결과로 연결된 할 일"}</Link></div>}
      {(dialog!=="edit"||record.record_kind==="change")&&<><TagNames ids={record.tag_ids}/>
      <EntityLinks ids={record.entity_ids} context={record.entity_context}/></>}
      <PrincipleSnapshots snapshots={record.applied_principle_snapshots??[]}/>
      <details className="record-audit"><summary>저장 정보</summary><p className="meta">
        만든 시각 {formatDateTime(record.created_at)} · 수정 {formatDateTime(record.updated_at)}
      </p>{record.change&&<p className="help">이 기록의 정정·삭제는 대상의 업무 상태를 되돌리지 않습니다.</p>}</details>
    </div>;
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface footer={<button type="button" className="btn btn-primary" onClick={startEdit}>편집</button>} title="기록" onClose={()=>dialog==="edit"&&!editReady?closeEdit():navigate(back)} busy={busy}>

      {record.body&&<section className="detail-section record-content" aria-label="내용"><MarkdownContent text={record.body}/></section>}
      {dialog!=="edit"&&<section className="detail-section" aria-label="기록 정보">{management}</section>}
      {dialog === "edit" && !editReady && loadError && <>
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn" onClick={reload}>조회 다시 시도</button>
      </>}
      {dialog === "edit" && editReady && (
        <RecordFormModal
          editing systemRecord={record.record_kind==="change"}
          title="기록 편집"
          submitLabel="저장"
          open
          initial={recordDraftFrom(record)}
          details={<section className="detail-section"><h2 className="section-title">저장 정보 (읽기 전용)</h2>{management}</section>}
          deletion={{note:false,message:<p style={{ margin: 0 }}>
            이 기록을 삭제합니다. {record.record_kind==="change"?"대상의 업무 상태는 되돌리지 않습니다.":"일회성 할 일의 결과였다면 할 일은 완료 상태로 남고 결과 연결만 사라집니다."}
          </p>,onConfirm:async () => {
          setBusy(true);
          setError(null);
          try {
            await api("DELETE", `/records/${record.id}${query({expected_version:record.version})}`);
            setDialog(null);
            navigateAfterClose(listPath,true);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "삭제하지 못했습니다.");
            throw e;
          } finally {
            setBusy(false);
          }
        }}}
          onClose={closeEdit}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value) => {
            loadGeneration.current++;
            try {
            setRecord(await api<WorkspaceRecord>("PATCH", `/records/${record.id}`, {
              ...value,
              expected_version: record.version,
            }));
            }catch(e){if(e instanceof ApiError&&e.code==="conflict")conflicted.current=true;throw e;}
             closeEdit();
            setMessage("저장했습니다.");
          }}
        />
      )}

    </DetailSurface>;
}
