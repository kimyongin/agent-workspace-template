import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { tagCreate, tagLabels, type TagResult } from "@contracts/tag.ts";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { DeleteDialog } from "../../components/DeleteDialog.tsx";
import { query } from "../../lib/api.ts";
import { BusyNavigationGuard, ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
import { api, ApiError, isUncertain } from "../../lib/api.ts";
import { useCreationId } from "../../lib/useCreationId.ts";
import "./tags.css";
import { findTag } from "./resolve-tag.ts";
type Page = { items: TagResult[]; next_cursor: string | null };
type Draft = { initial: TagResult | null; name: string };
export function TagsPage() {
  const {pathname}=useLocation(),route=useParams(),[params]=useSearchParams();
  const scope=route.scope==="entity"||pathname.endsWith("/entity")?"entity":"activity";
  const id=route.id??(route.scope&&/^[0-9a-f-]{36}$/i.test(route.scope)?route.scope:null);
  if(id){const next=new URLSearchParams(params);if(next.get("edit")==="1"){next.set("edit",id);next.delete("view");}else if(!next.has("edit"))next.set("view",id);return <Navigate to={`/tags/${scope}?${next}`} replace/>;}
  return <ScopedTagsPage key={scope} scope={scope}/>;
}
function ScopedTagsPage({scope}:{scope:"entity"|"activity"}) {
  const location=useLocation(),[params]=useSearchParams(),navigateAfterClose=useDeferredNavigation();
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [fieldError, setFieldError] = useState<string | undefined>();
  const [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null), [deleting, setDeleting] = useState<TagResult | null>(null);
  const pageCount = useRef(1), focusId = useRef<string | null>(null), input = useRef<HTMLInputElement>(null), saving = useRef(false);
  const readEpoch = useRef(0), readAbort = useRef<AbortController | null>(null);
  const invalidateReads = () => { readEpoch.current++; readAbort.current?.abort(); };
  useEffect(() => () => { readEpoch.current++; readAbort.current?.abort(); }, []);
  const creationId = useCreationId();
  const dirty = !!draft && (draft.name !== (draft.initial?.name ?? "") || uncertain);
  useEffect(() => {
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    const epoch = ++readEpoch.current; const current = () => !controller.signal.aborted && epoch === readEpoch.current;
    setLoading(true); setError(null);
    (async () => {
      let loaded: Page = { items: [], next_cursor: null };
      for (let i = 0; i < pageCount.current; i++) {
        const next = await api<Page>("GET", `/tags?scope=${scope}${loaded.next_cursor ? `&cursor=${encodeURIComponent(loaded.next_cursor)}` : ""}`, undefined, controller.signal);
        loaded = { items: [...loaded.items, ...next.items], next_cursor: next.next_cursor }; if (!next.next_cursor) break;
      }
      if (current()) setPage(loaded);
    })().catch(() => { if (current()) setError("태그 목록을 불러오지 못했습니다. 기존 목록은 유지합니다."); })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [retry,scope]);
  useEffect(() => { if (focusId.current && !loading) {
    (document.getElementById(`tag-${focusId.current}`) ?? document.getElementById("tags-title"))?.focus(); focusId.current = null;
  } }, [page, loading]);
  const change = (action: () => void) => { if (busy) return; if (dirty) setPending(() => action); else action(); };
  const select = (tag: TagResult | null, read=false) => change(() => {
    setDraft({ initial: tag, name: tag?.name ?? "" }); setFailure(null); setNotice(null); setFieldError(undefined); setUncertain(false); setConflict(false); creationId.renew();
    const p=new URLSearchParams(params);p.delete("view");p.delete("edit");p.delete("create");tag?p.set(read?"view":"edit",tag.id):p.set("create","1");navigateAfterClose(`?${p}`,true);
    requestAnimationFrame(() => input.current?.focus());
  });
  const dismiss = () => {const p=new URLSearchParams(params);p.delete("view");p.delete("edit");p.delete("create");navigateAfterClose(`?${p}`,true);};
  useEffect(()=>{let alive=true; const selected=params.get("edit")??params.get("view");
    if(params.get("create")==="1"){if(!draft){creationId.renew();setDraft({initial:null,name:""});}return;}
    if(selected&&draft?.initial?.id!==selected)findTag(selected,cursor=>api<Page>("GET",`/tags?scope=${scope}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`)).then(tag=>{if(alive){if(tag){creationId.renew();setDraft({initial:tag,name:tag.name});}else setFailure("태그를 찾을 수 없습니다.");}}).catch(()=>{if(alive)setFailure("태그를 불러오지 못했습니다.");});
    return()=>{alive=false;};
  },[location.key]);
  const cancel = () => {
    const id = draft?.initial?.id ?? "heading"; setDraft(null); setUncertain(false);
    if (conflict) { focusId.current = id; setRetry(n => n + 1); }
    else requestAnimationFrame(() => (document.getElementById(`tag-${id}`) ?? document.getElementById("tags-title"))?.focus());
    dismiss();
  };
  const save = async () => {
    if (!draft || saving.current || conflict) return;
    const parsed = tagCreate.omit({id:true}).safeParse({ name: draft.name });
    if (!parsed.success) { setFieldError(parsed.error.issues[0]?.message); input.current?.focus(); return; }
    saving.current = true; setBusy(true); setFailure(null); setFieldError(undefined);
    try {
      const saved = await api<TagResult>(draft.initial ? "PATCH" : "POST", draft.initial ? `/tags/${draft.initial.id}` : "/tags",
        draft.initial ? { name: parsed.data.name, expected_version: draft.initial.version } : { ...parsed.data, scope, id: creationId.current });
      invalidateReads();
      setPage(p => p ? { ...p, items: p.items.some(t => t.id === saved.id) ? p.items.map(t => t.id === saved.id ? saved : t) : [saved, ...p.items] } : { items: [saved], next_cursor: null });
      focusId.current = saved.id; setDraft(null); setUncertain(false); creationId.renew(); setNotice("태그를 저장했습니다."); dismiss(); setRetry(n => n + 1);
    } catch (e) {
      setUncertain(isUncertain(e));
      if (e instanceof ApiError && e.code === "conflict") {
        let versionConflict = false, readFailure = false;
        if (draft.initial) {
          try { const current = await findTag(draft.initial.id, cursor => api<Page>("GET", `/tags?scope=${scope}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)); versionConflict = !current || current.version !== draft.initial.version; }
          catch { readFailure = true; }
        }
        setConflict(versionConflict);
        setFailure(versionConflict ? "다른 변경이 저장되었습니다. 초안을 유지합니다. 취소 후 최신 태그를 다시 선택하세요." : readFailure ? `${e.message} 최신 상태를 조회하지 못했습니다. 초안을 유지합니다.` : e.message);
        if (!versionConflict && !readFailure) setFieldError(e.message);
      }
      else setFailure(isUncertain(e) ? "응답을 받지 못해 저장 여부를 알 수 없습니다. 같은 내용으로 다시 시도할 수 있습니다. 충돌하면 최신 상태를 확인하세요." : e instanceof ApiError ? e.message : "저장하지 못했습니다.");
      if (e instanceof ApiError && e.fields.some(f => f.path === "name")) setFieldError(e.fields.find(f => f.path === "name")?.message);
    } finally { saving.current = false; setBusy(false); }
  };
  return <section className="panel" aria-labelledby="tags-title">
    <div className="panel-head"><h1 id="tags-title" tabIndex={-1} className="page-title">{scope==="entity"?"엔터티":"활동"} 태그 관리</h1><button className="btn btn-primary" disabled={busy} onClick={() => select(null)}>태그 추가</button></div>
    {notice && <Notice>{notice}</Notice>}
    {error && <><Notice kind="error">{error}</Notice><button className="btn" disabled={loading} onClick={() => setRetry(n => n + 1)}>목록 다시 시도</button></>}
    {loading && <p className="secondary" role="status">불러오는 중…</p>}
    {page?.items.length === 0 && <p className="secondary">아직 태그가 없습니다. 태그를 추가해 항목을 분류하세요.</p>}
    <div className="tag-management"><ul className="list">{page?.items.map(t => <li key={t.id} className="list-item"><span className="item-title">{t.name}</span><div className="actions">
      <button className="btn" disabled={busy} aria-label={`${t.name} 보기`} onClick={()=>select(t,true)}>보기</button>
      <button id={`tag-${t.id}`} className="btn" disabled={busy} aria-pressed={draft?.initial?.id === t.id} aria-label={`${t.name} 이름 변경`} onClick={() => select(t)}>이름 변경</button>
      <button className="btn btn-danger" disabled={busy} aria-label={`${t.name} 삭제`} onClick={() => change(() => { setDraft(null); setUncertain(false);creationId.renew(); setDeleting(t); })}>삭제</button>
    </div></li>)}</ul>
    {draft && <ModalShell open title={params.has("view")?draft.name:draft.initial?"태그 이름 변경":"태그 추가"} dirty={dirty} busy={busy} onClose={cancel} onRouteDiscard={()=>{setDraft(null);setUncertain(false);}} footer={requestClose=>params.has("view")?<button className="btn" onClick={()=>select(draft.initial)}>편집</button>:<><button type="button" className="btn" disabled={busy} onClick={requestClose}>취소</button><button form="tag-edit-form" type="submit" className="btn btn-primary" disabled={busy||conflict}>{busy?"저장 중…":uncertain?"같은 내용 다시 시도":"저장"}</button></>}><form id="tag-edit-form" className="form tag-editor" aria-label={draft.initial ? "태그 이름 변경" : "태그 추가"} onSubmit={e => { e.preventDefault(); void save(); }}>
      {params.has("view")?<><h2 className="section-title">{draft.name}</h2><p className="help">{scope==="entity"?"엔터티":"할 일·기록"}에 사용하는 태그입니다.</p></>:<>
      {failure && <Notice kind="error">{failure}</Notice>}
      <Field label={tagLabels.name} required error={fieldError} help="1~30자, 같은 이름은 대소문자를 구분하지 않습니다.">{p => <input {...p} ref={input} className="input" value={draft.name} readOnly={busy || uncertain} onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} />}</Field>
    </>}
    </form></ModalShell>}</div>
    {page?.next_cursor && <button className="btn" disabled={loading || busy} onClick={async () => {
      const epoch = readEpoch.current, controller = new AbortController(); readAbort.current = controller;
      const current = () => !controller.signal.aborted && epoch === readEpoch.current;
      setLoading(true); setError(null); try { const next = await api<Page>("GET", `/tags?scope=${scope}&cursor=${encodeURIComponent(page.next_cursor!)}`, undefined, controller.signal);
        if (!current()) return;
        setPage(p => p && ({ items: [...p.items, ...next.items.filter(t => !p.items.some(old => old.id === t.id))], next_cursor: next.next_cursor })); pageCount.current++;
      } catch { if (current()) setError("다음 태그를 불러오지 못했습니다."); } finally { if (current()) setLoading(false); }
    }}>더 보기</button>}
    <ConfirmDialog open={!!pending} busy={busy} title="변경을 버릴까요?" message="저장하지 않은 내용이 사라집니다." confirmLabel="변경 버리기"
      onCancel={() => setPending(null)}
      onConfirm={() => {const action=pending;setPending(null);action?.();}} />
    {deleting && <><BusyNavigationGuard pending={saving}/><DeleteDialog title="태그를 삭제할까요?" busy={busy} message={`${deleting.name} 태그와 연결을 제거합니다. 항목의 원문은 보존합니다.`} onCancel={() => setDeleting(null)} onConfirm={async reason => {
      if (saving.current) return; saving.current = true; setBusy(true); setFailure(null);
      try { await api("DELETE", `/tags/${deleting.id}${query({expected_version:deleting.version,change_note:reason})}`);
        invalidateReads();
        const at = page?.items.findIndex(t => t.id === deleting.id) ?? -1; focusId.current = page?.items[at + 1]?.id ?? page?.items[at - 1]?.id ?? "heading";
        setPage(p => p && ({ ...p, items: p.items.filter(t => t.id !== deleting.id) })); setNotice("태그를 삭제했습니다.");
      } catch (e) { focusId.current = deleting.id; setNotice(null); setFailure(isUncertain(e) ? "삭제 응답을 받지 못했습니다. 최신 목록에서 삭제 여부를 확인하세요." : e instanceof ApiError ? e.message : "삭제하지 못했습니다."); }
      finally { setDeleting(null); setRetry(n => n + 1); setBusy(false); saving.current = false; }
    }} /></>}
    {!draft && failure && <Notice kind="error">{failure}</Notice>}
  </section>;
}
