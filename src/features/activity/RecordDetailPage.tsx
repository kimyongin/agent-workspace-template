// 기록 상세: 원문 읽기, 편집, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import { recordLabels } from "@contracts/record.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { RecordFormModal, recordDraftFrom } from "./forms.tsx";
import {TagNames} from "../tags/TagPicker.tsx";
import {EntityLink} from "../entity/EntityPicker.tsx";
import {useSearchReturn} from "../search/return.ts";
import { safeListReturn } from "./list-state.ts";

export function RecordDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useSearchReturn(safeListReturn(params.get("list"), "records", `/records${query({tag_id:params.get("tag_id")??"",entity_id:params.get("entity_id")??""})}`),"← 기록 목록");
  const listPath = back.path;
  const navigate = useNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const [record, setRecord] = useState<RecordResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const directEdit = params.get("edit") === "1";
  const [dialog, setDialog] = useState<null | "edit" | "delete">(directEdit ? "edit" : null);
  const closeEdit = () => { setDialog(null); if(directEdit)navigateAfterClose(back.path,true); };
  const [busy, setBusy] = useState(false);

  const previousQuery = useRef(params.toString());
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const started = ++loadGeneration.current;
    try {
      const loaded = await api<RecordResult>("GET", `/records/${id}`);
      if(started !== loadGeneration.current)return;
      setRecord(loaded);
      setLoadError(null);
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
    if(directEdit){setRecord(null);void reload();}
  },[params.toString(),reload]);

  if (loadError && !record) {
    return (
      <section className="panel">
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn" onClick={reload}>조회 다시 시도</button>
        <Link to={listPath}>{back.label}</Link>
      </section>
    );
  }
  if (!record) return <p className="secondary" role="status">불러오는 중…</p>;

  return (
    <section className="panel" aria-labelledby="record-title">
      <div className="panel-head">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
          <Link to={listPath} className="secondary back-link">{back.label}</Link>
          <h1 id="record-title" className="page-title">{record.title}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setDialog("edit")}>편집</button>
          <button type="button" className="btn btn-danger" onClick={() => setDialog("delete")}>삭제</button>
        </div>
      </div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <p className="document-summary">{record.summary}</p>
      {loadError && <><Notice kind="error">{loadError}</Notice><button type="button" className="btn" onClick={reload}>조회 다시 시도</button></>}
      <dl className="props">
        <div>
          <dt>{recordLabels.occurred_at}</dt>
          <dd>{formatDateTime(record.occurred_at)}</dd>
        </div>
      </dl>
      <div><h2 className="section-title">{recordLabels.body}</h2><MarkdownContent text={record.body} /></div>
      {record.task_id && <div><h2 className="section-title">관련 할 일</h2><Link to={`/tasks/${record.task_id}`}>{record.occurrence_on ? `${record.occurrence_on} 회차` : "결과로 연결된 할 일"}</Link></div>}
      <TagNames ids={record.tag_ids}/>
      <EntityLink id={record.entity_id}/>
      <div>
        <h2 className="section-title">적용한 원칙</h2>
        {record.applied_principles.length?<ul className="list">{record.applied_principles.map(p=><li key={p.id} className="list-item">
          <Link className="item-title" to={`/principles/${p.id}`}>{p.title}</Link>
          <span className="meta">{p.status==="active"?"활성":"비활성"} · 현재 원칙 수정 {formatDateTime(p.updated_at)}</span>
        </li>)}</ul>:<p className="secondary">없음</p>}
        <p className="help">연결은 원칙의 현재 내용입니다. 당시 판단의 근거는 기록 본문을 확인하세요.</p>
      </div>
      <p className="meta" style={{ margin: 0 }}>
        만든 시각 {formatDateTime(record.created_at)} · 수정 {formatDateTime(record.updated_at)}
      </p>

      {dialog === "edit" && (
        <RecordFormModal
          title="기록 편집"
          submitLabel="저장"
          open
          initial={recordDraftFrom(record)}
          onClose={closeEdit}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value) => {
            loadGeneration.current++;
            setRecord(await api<RecordResult>("PATCH", `/records/${record.id}`, { ...value, expected_version: record.version }));
            closeEdit();
            setMessage("저장했습니다.");
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        title="기록을 삭제할까요?"
        message={
          <p style={{ margin: 0 }}>
            「{record.title}」을(를) 삭제합니다. 일회성 할 일의 결과였다면 할 일은 완료 상태로 남고 결과 연결만 사라집니다.
          </p>
        }
        confirmLabel="삭제"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await api("DELETE", `/records/${record.id}?expected_version=${record.version}`);
            navigate(listPath, { replace: true });
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "삭제하지 못했습니다.");
            setDialog(null);
            await reload();
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
