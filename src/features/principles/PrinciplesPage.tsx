import { principleCreate, principleLabels, type PrincipleResult } from "@contracts/principle.ts";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FormModal, TextFields } from "../../components/ContentForm.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { fieldErrors } from "../../lib/format.ts";
import { useRequestId } from "../../lib/useRequestId.ts";

type Page = { items: PrincipleResult[]; next_cursor: string | null };
export function PrinciplesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setPage(null); setError(null);
    api<Page>("GET", `/principles${query({ status })}`).then((p) => { if (alive) setPage(p); })
      .catch(() => { if (alive) setError("원칙을 불러오지 못했습니다. 조건을 확인하거나 다시 시도하세요."); });
    return () => { alive = false; };
  }, [status, retry]);
  const more = async () => {
    if (!page?.next_cursor) return;
    setLoadingMore(true); setError(null);
    try {
      const p = await api<Page>("GET", `/principles${query({ status, cursor: page.next_cursor })}`);
      setPage((prev) => prev ? { items: [...prev.items, ...p.items], next_cursor: p.next_cursor } : prev);
    } catch { setError("다음 항목을 불러오지 못했습니다. 다시 시도하세요."); }
    finally { setLoadingMore(false); }
  };
  return <section className="panel" aria-labelledby="principles-title">
    <div className="panel-head"><h1 id="principles-title" className="page-title">원칙</h1>
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>원칙 추가</button></div>
    <Field label="원칙 상태">{(p) => <select {...p} className="input" value={status} disabled={loadingMore}
      onChange={(e) => setParams({ status: e.target.value })}>
      <option value="active">활성</option><option value="inactive">비활성</option>
    </select>}</Field>
    {error && <><Notice kind="error">{error}</Notice>{!page && <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>다시 시도</button>}</>}
    {!page && !error && <p role="status" className="secondary">불러오는 중…</p>}
    {page?.items.length === 0 && <p className="secondary">이 조건에 해당하는 원칙이 없습니다.</p>}
    {page && <ul className="list">{page.items.map((p) => <li key={p.id} className="list-item"><div className="list-item-main">
      <Link to={`/principles/${p.id}?${params}`} className="item-title">{p.title}</Link>
      <span className="secondary">{p.summary}</span><span className="meta">{principleLabels[p.status]}</span>
    </div></li>)}</ul>}
    {page?.next_cursor && <button type="button" className="btn" disabled={loadingMore} onClick={more}>{loadingMore ? "불러오는 중…" : "더 보기"}</button>}
    {creating && <CreatePrinciple onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/principles/${id}`); }} />}
  </section>;
}

function CreatePrinciple({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [draft, setDraft] = useState({ title: "", summary: "", body: "", applies_when: "" });
  const request = useRequestId();
  return <FormModal title="원칙 추가" open submitLabel="저장" dirty={Object.values(draft).some(Boolean)} onClose={onClose}
    validate={() => { const result = principleCreate.safeParse(draft); return result.success ? null : fieldErrors(result.error.issues); }}
    onSubmit={async () => {
      const result = await api<PrincipleResult>("POST", "/principles", { ...principleCreate.parse(draft), request_id: request.current });
      request.renew(); onCreated(result.id);
    }}>
    {(errors) => <>
      <TextFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} errors={errors} />
      <Field label={principleLabels.applies_when} error={errors.applies_when} help="이 원칙을 적용할 상황, 300자 이하">
        {(p) => <textarea {...p} className="input" rows={3} value={draft.applies_when} onChange={(e) => setDraft((d) => ({ ...d, applies_when: e.target.value }))} />}
      </Field>
    </>}
  </FormModal>;
}
