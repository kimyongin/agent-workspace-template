// 기록 상세: 원문 읽기, 편집, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import { recordLabels } from "@contracts/record.ts";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { RecordFormModal, recordDraftFrom } from "./forms.tsx";

export function RecordDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<RecordResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "edit" | "delete">(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRecord(await api<RecordResult>("GET", `/records/${id}`));
    } catch (e) {
      setLoadError(e instanceof ApiError && e.code === "not_found" ? "기록을 찾을 수 없습니다." : "기록을 불러오지 못했습니다.");
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loadError) {
    return (
      <section className="panel">
        <Notice kind="error">{loadError}</Notice>
        <Link to="/records">기록 목록으로</Link>
      </section>
    );
  }
  if (!record) return <p className="secondary" role="status">불러오는 중…</p>;

  return (
    <section className="panel" aria-labelledby="record-title">
      <div className="panel-head">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
          <Link to="/records" className="secondary back-link">← 기록 목록</Link>
          <h1 id="record-title" className="page-title">{record.title}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setDialog("edit")}>편집</button>
          <button type="button" className="btn btn-danger" onClick={() => setDialog("delete")}>삭제</button>
        </div>
      </div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <dl className="props">
        <div>
          <dt>{recordLabels.occurred_at}</dt>
          <dd>{formatDateTime(record.occurred_at)}</dd>
        </div>
        <div>
          <dt>{recordLabels.task_id}</dt>
          <dd>
            {record.task_id
              ? <Link to={`/tasks/${record.task_id}`}>{record.occurrence_on ? `${record.occurrence_on} 회차` : "결과로 연결된 할 일"}</Link>
              : "없음"}
          </dd>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <dt>{recordLabels.summary}</dt>
          <dd>{record.summary}</dd>
        </div>
      </dl>
      <div>
        <h2 className="section-title">적용한 원칙</h2>
        {record.applied_principles.length?<ul className="list">{record.applied_principles.map(p=><li key={p.id} className="list-item">
          <Link className="item-title" to={`/principles/${p.id}`}>{p.title}</Link>
          <span className="meta">{p.status==="active"?"활성":"비활성"} · 현재 원칙 수정 {formatDateTime(p.updated_at)}</span>
        </li>)}</ul>:<p className="secondary">없음</p>}
        <p className="help">연결은 원칙의 현재 내용입니다. 당시 판단의 근거는 기록 본문을 확인하세요.</p>
      </div>
      <div>
        <h2 className="section-title">{recordLabels.body}</h2>
        <MarkdownContent text={record.body} />
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
          onClose={() => setDialog(null)}
          onSave={async (value) => {
            setRecord(await api<RecordResult>("PATCH", `/records/${record.id}`, { ...value, expected_version: record.version }));
            setDialog(null);
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
            navigate("/records", { replace: true });
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
