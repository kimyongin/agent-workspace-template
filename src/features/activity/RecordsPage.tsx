// 기록 목록(수행 시각 내림차순)과 직접 작성.
import type { RecordResult } from "@contracts/record.ts";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal } from "./forms.tsx";
import { useRequestId } from "./shared.tsx";

type Page = { items: RecordResult[]; next_cursor: string | null };

export function RecordsPage() {
  const [items, setItems] = useState<RecordResult[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const requestId = useRequestId();
  const navigate = useNavigate();

  useEffect(() => {
    api<Page>("GET", `/records${query({ limit: 20 })}`)
      .then((p) => {
        setItems(p.items);
        setCursor(p.next_cursor);
      })
      .catch(() => setError("기록을 불러오지 못했습니다."));
  }, []);

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const p = await api<Page>("GET", `/records${query({ limit: 20, cursor })}`);
      setItems((prev) => [...(prev ?? []), ...p.items]);
      setCursor(p.next_cursor);
    } catch {
      setError("다음 항목을 불러오지 못했습니다. 다시 시도하세요.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="records-title">
      <div className="panel-head">
        <h1 id="records-title" className="page-title">기록</h1>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>기록 작성</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {items === null && !error && <p className="secondary" role="status">불러오는 중…</p>}
      {items?.length === 0 && (
        <p className="secondary" style={{ margin: 0 }}>아직 기록이 없습니다. 수행한 일과 결과를 기록하세요.</p>
      )}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((r) => (
            <li key={r.id} className="list-item">
              <div className="list-item-main">
                <Link className="item-title" to={`/records/${r.id}`}>{r.title}</Link>
                <span className="secondary">{r.summary}</span>
                <span className="meta">
                  {formatDateTime(r.occurred_at)}
                  {r.occurrence_on ? ` · ${r.occurrence_on} 회차` : r.task_id ? " · 할 일 결과" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" className="btn" onClick={more} disabled={loadingMore}>
          {loadingMore ? "불러오는 중…" : "더 보기"}
        </button>
      )}
      {creating && (
        <RecordFormModal
          title="기록 작성"
          submitLabel="저장"
          open
          initial={emptyRecord()}
          onClose={() => setCreating(false)}
          onSave={async (value) => {
            const created = await api<RecordResult>("POST", "/records", { ...value, request_id: requestId.current });
            requestId.renew();
            setCreating(false);
            navigate(`/records/${created.id}`);
          }}
        />
      )}
    </section>
  );
}
