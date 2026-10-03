import { principleLabels, type PrincipleResult } from "@contracts/principle.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { PrincipleFormModal, emptyPrinciple } from "./forms.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import {TagFilter} from "../tags/TagPicker.tsx";
import {EntityPicker} from "../entity/EntityPicker.tsx";

type Page = { items: PrincipleResult[]; next_cursor: string | null };
export function PrinciplesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const tag_id=params.get("tag_id")??"";
  const entity_id=params.get("entity_id")??"";
  const requestedPages = Number(params.get("pages") ?? 1);
  const pages = Number.isSafeInteger(requestedPages) && requestedPages > 0 ? requestedPages : 1;
  const loaded = useRef<{ status: string;tag_id:string;entity_id:string; retry: number; count: number; page: Page } | null>(null);
  const generation = useRef(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();
  const { hash } = useLocation();
  const focused = useRef(false);
  useEffect(() => {
    if (loadingMore || focused.current || !/^#principle-[0-9a-f-]+$/.test(hash)) return;
    const target = document.getElementById(hash.slice(1));
    if (target) { target.focus(); target.scrollIntoView({ block: "center" }); focused.current = true; }
  }, [hash, page, loadingMore]);

  useEffect(() => {
    let alive = true;
    generation.current++;
    const prior = loaded.current;
    const cached = prior?.status === status && prior.tag_id===tag_id && prior.entity_id===entity_id && prior.retry === retry && prior.count <= pages ? prior : null;
    if (!cached) { loaded.current = null; setPage(null); }
    setError(null);
    setLoadingMore(!cached || cached.count < pages);
    const restore = async () => {
      let result = cached?.page ?? null;
      let count = cached?.count ?? 0;
      // 상세 왕복·새로고침 때 URL에 보관한 페이지 범위를 현재 데이터로 다시 조회한다.
      const anchor = /^#principle-[0-9a-f-]+$/.test(hash) ? hash.slice(11) : null;
      // 동시 추가로 항목이 뒤 페이지로 밀려도 이전 상세의 항목까지 복원한다.
      while ((count < pages || (anchor && !result?.items.some(p => p.id === anchor))) && (!result || result.next_cursor)) {
        const next: Page = await api<Page>("GET", `/principles${query({ status,tag_id,entity_id, cursor: result?.next_cursor })}`);
        if (!alive) return;
        result = { items: [...(result?.items ?? []), ...next.items], next_cursor: next.next_cursor };
        count++;
        loaded.current = { status,tag_id,entity_id, retry, count, page: result };
        setPage(result);
      }
    };
    restore().catch(() => { if (alive) setError("원칙을 불러오지 못했습니다. 조건을 확인하거나 다시 시도하세요."); })
      .finally(() => { if (alive) setLoadingMore(false); });
    return () => { alive = false; generation.current++; };
  }, [status,tag_id,entity_id, pages, retry, hash]);
  const more = async () => {
    if (!page?.next_cursor) return;
    const started = generation.current;
    setLoadingMore(true); setError(null);
    try {
      const p = await api<Page>("GET", `/principles${query({ status,tag_id,entity_id, cursor: page.next_cursor })}`);
      if (generation.current !== started) return;
      const combined = { items: [...page.items, ...p.items], next_cursor: p.next_cursor };
      const count = (loaded.current?.count ?? 1) + 1;
      loaded.current = { status,tag_id,entity_id, retry, count, page: combined };
      setPage(combined);
      const nextParams = new URLSearchParams(params);
      nextParams.set("pages", String(count));
      setParams(nextParams, { replace: true });
    } catch { if (generation.current === started) setError("다음 항목을 불러오지 못했습니다. 다시 시도하세요."); }
    finally { if (generation.current === started) setLoadingMore(false); }
  };
  return <section className="panel" aria-labelledby="principles-title">
    <div className="panel-head"><h1 id="principles-title" className="page-title">원칙</h1>
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>원칙 추가</button></div>
    <Field label="원칙 상태">{(p) => <select {...p} className="input" value={status} disabled={loadingMore}
      onChange={(e) => setParams({ status: e.target.value,tag_id,entity_id })}>
      <option value="active">활성</option><option value="inactive">비활성</option>
    </select>}</Field>
    <TagFilter value={tag_id} onChange={id=>setParams({status,tag_id:id,entity_id})}/>
    <EntityPicker label="엔터티 필터" value={entity_id} onChange={id=>setParams({status,tag_id,entity_id:id??""})}/>
    {error && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>다시 시도</button></>}
    {!page && !error && <p role="status" className="secondary">불러오는 중…</p>}
    {page?.items.length === 0 && <p className="secondary">이 조건에 해당하는 원칙이 없습니다.</p>}
    {page && <ul className="list">{page.items.map((p) => <li key={p.id} className="list-item"><div className="list-item-main">
      <Link id={`principle-${p.id}`} to={`/principles/${p.id}?${params}`} className="item-title">{p.title}</Link>
      <span className="secondary">{p.summary}</span><span className="meta">{principleLabels[p.status]}</span>
    </div></li>)}</ul>}
    {page?.next_cursor && <button type="button" className="btn" disabled={loadingMore} onClick={more}>{loadingMore ? "불러오는 중…" : "더 보기"}</button>}
    {creating && <CreatePrinciple onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/principles/${id}`); }} />}
  </section>;
}

function CreatePrinciple({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const request = useRequestId();
  return <PrincipleFormModal initial={emptyPrinciple} onClose={onClose} onSave={async draft => {
    const result = await api<PrincipleResult>("POST","/principles",{...draft,request_id:request.current});
    request.renew(); onCreated(result.id);
  }}/>;
}
