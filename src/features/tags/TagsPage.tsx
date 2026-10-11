import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { tagCreate, tagLabels, type TagResult } from "@contracts/tag.ts";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { DeleteAction, type DeletionState } from "../../components/DeleteAction.tsx";
import { query } from "../../lib/api.ts";
import { ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import "./tags.css";
import { useDetailExploration, useDetailNavigate } from "../../lib/detail-exploration.tsx";
import { tagScopeLabels, type TagScope } from "./TagPicker.tsx";
import { createTagRead } from "./tag-read.ts";
const tagRead = createTagRead(api);
type Page = { items: TagResult[]; next_cursor: string | null };
type Draft = { initial: TagResult | null; name: string };
export function TagsPage() {
  const {pathname}=useLocation(),route=useParams(),[params]=useSearchParams();
  const scope=route.scope==="entity"||pathname.endsWith("/entity")?"entity":route.scope==="task"||pathname.endsWith("/task")?"task":"record";
  const id=route.id??(route.scope&&/^[0-9a-f-]{36}$/i.test(route.scope)?route.scope:null);
  if(id){const next=new URLSearchParams(params);if(next.get("edit")==="1"){next.set("edit",id);next.delete("view");}else if(!next.has("edit"))next.set("edit",id);return <Navigate to={`/tags/${scope}?${next}`} replace/>;}
  return <ScopedTagsPage key={scope} scope={scope}/>;
}
function ScopedTagsPage({scope}:{scope:TagScope}) {
  const location=useLocation(),[params]=useSearchParams(),navigateAfterClose=useDeferredNavigation();
  const previous=useDetailExploration(),navigate=useDetailNavigate();
  const [closing,setClosing]=useState(false);
  const close=()=>{setDraft(null);attempt.reset();setClosing(true);};
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [retry, setRetry] = useState(0), [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [deletingBusy, setDeletingBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [fieldError, setFieldError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const {attempt, uncertain, busy: writing} = useWriteAttempt();
  const [deletionState,setDeletionState]=useState<DeletionState>({armed:false,busy:false,uncertain:false});
  const [deletions,setDeletions]=useState<Record<string,DeletionState>>({});
  const deletionDirty=Object.values(deletions).some(state=>state.armed||state.uncertain);
  const busy = writing || deletingBusy;
  useEffect(()=>{if(closing&&!busy){setClosing(false);if(previous)previous.back();else void navigate(scope==="entity"?"/entities":scope==="task"?"/tasks":"/records");}},[closing,busy,previous,navigate,scope]);
  const [pending, setPending] = useState<(() => void) | null>(null);
  useEffect(()=>{setDeletionState({armed:false,busy:false,uncertain:false});},[draft?.initial?.id,!!draft]);
  const pageCount = useRef(1), focusId = useRef<string | null>(null), input = useRef<HTMLInputElement>(null), saving = useRef(false);
  const readEpoch = useRef(0), readAbort = useRef<AbortController | null>(null);
  const invalidateReads = () => { readEpoch.current++; readAbort.current?.abort(); };
  useEffect(() => () => { readEpoch.current++; readAbort.current?.abort(); }, []);
  const dirty = !closing && (deletionDirty || !!draft && (draft.name !== (draft.initial?.name ?? "") || uncertain));
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
  useEffect(() => {
    if (!focusId.current || loading) return;
    // Restore focus after the confirmation stage has revealed the refreshed management list.
    const frame = requestAnimationFrame(() => {
      (document.getElementById(`tag-${focusId.current}`) ?? document.querySelector<HTMLElement>("dialog[open] .dialog-title"))?.focus();
      focusId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, loading]);
  const change = (action: () => void) => { if (busy) return; if (dirty) setPending(() => action); else action(); };
  const select = (tag: TagResult) => change(() => {
    setDraft({initial:tag,name:tag.name});setFailure(null);setNotice(null);setFieldError(undefined);attempt.startNewIntent();setConflict(false);
    const p=new URLSearchParams(params);p.delete("view");p.delete("create");p.delete("edit_from");p.set("edit",tag.id);navigateAfterClose(`?${p}`,true);
    requestAnimationFrame(()=>input.current?.focus());
  });
  const dismiss = () => {const p=new URLSearchParams(params);for(const key of ["view","edit","create","edit_from"])p.delete(key);navigateAfterClose(`?${p}`,true);};
  useEffect(()=>{const controller=new AbortController(); const selected=params.get("edit")??params.get("view");
    if(params.get("create")==="1"){if(!draft){attempt.startNewIntent();setDraft({initial:null,name:""});}return;}
    if(selected&&draft?.initial?.id!==selected)tagRead.find(scope,selected,controller.signal).then(tag=>{if(!controller.signal.aborted){if(tag){attempt.startNewIntent();setDraft({initial:tag,name:tag.name});}else setFailure("태그를 찾을 수 없습니다.");}}).catch(()=>{if(!controller.signal.aborted)setFailure("태그를 불러오지 못했습니다.");});
    return()=>controller.abort();
  },[location.key]);
  const cancel = () => {
    if(attempt.snapshot().uncertain){setNotice("이전 저장 결과를 확인하지 못했습니다. 새 작업 전에 갱신된 태그 목록을 확인하세요.");setRetry(n=>n+1);}
    const id = draft?.initial?.id ?? "heading"; setDraft(null); attempt.reset();setFailure(null);setFieldError(undefined);setConflict(false);
    if (conflict) { focusId.current = id; setRetry(n => n + 1); }
    else requestAnimationFrame(() => (document.getElementById(`tag-${id}`) ?? document.querySelector<HTMLElement>("dialog[open] .dialog-title"))?.focus());
    dismiss();
  };
  const save = async () => {
    if (attempt.snapshot().busy || deletingBusy || conflict || deletionState.armed) return;
    const currentDraft=draft??{initial:null,name:""};
    const parsed = tagCreate.safeParse({ name: currentDraft.name });
    if (!parsed.success) { setFieldError(parsed.error.issues[0]?.message); input.current?.focus(); return; }
    setFailure(null); setFieldError(undefined);
    try {
      await attempt.run(async () => {
      const saved = await api<TagResult>(currentDraft.initial ? "PATCH" : "POST", currentDraft.initial ? `/tags/${currentDraft.initial.id}` : "/tags",
        currentDraft.initial ? { name: parsed.data.name, expected_version: currentDraft.initial.version } : { ...parsed.data, scope }, undefined, attempt.requestKey());
      invalidateReads();
      setPage(p => p ? { ...p, items: p.items.some(t => t.id === saved.id) ? p.items.map(t => t.id === saved.id ? saved : t) : [saved, ...p.items] } : { items: [saved], next_cursor: null });
      setNotice("태그를 저장했습니다.");
      focusId.current=saved.id;setDraft(null);attempt.reset();dismiss();
      setRetry(n => n + 1);
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") {
        let versionConflict = false, readFailure = false;
        if (currentDraft.initial) {
          try { const current = await tagRead.find(scope,currentDraft.initial.id); versionConflict = !current || current.version !== currentDraft.initial.version; }
          catch { readFailure = true; }
        }
        setConflict(versionConflict);
        setFailure(versionConflict ? "다른 변경이 저장되었습니다. 초안을 유지합니다. 취소 후 최신 태그를 다시 선택하세요." : readFailure ? `${e.message} 최신 상태를 조회하지 못했습니다. 초안을 유지합니다.` : e.message);
        if (!versionConflict && !readFailure) setFieldError(e.message);
      }
      else setFailure(writeErrorMessage(e));
      if (e instanceof ApiError && e.fields.some(f => f.path === "name")) setFieldError(e.fields.find(f => f.path === "name")?.message);
    }
  };
  const deleteTag = async (target:TagResult,reason:string,tags:string[]|undefined,requestKey:()=>string) => {
      if (saving.current) return; saving.current = true; setDeletingBusy(true); setFailure(null);
      try { await api("DELETE", `/tags/${target.id}${query({expected_version:target.version,change_note:reason,change_tag_ids:tags?.length ? tags.join(",") : undefined})}`, undefined, undefined, requestKey());
        invalidateReads();
        const at = page?.items.findIndex(t => t.id === target.id) ?? -1; focusId.current = page?.items[at + 1]?.id ?? page?.items[at - 1]?.id ?? "heading";
        setDeletions(current=>{const next={...current};delete next[target.id];return next;});
        setPage(p => p && ({ ...p, items: p.items.filter(t => t.id !== target.id) })); setNotice("태그를 삭제했습니다.");
        if(draft?.initial?.id===target.id){setDraft(null);attempt.reset();dismiss();}
        setRetry(n => n + 1);
      } catch (e) { focusId.current = target.id; setNotice(null); throw e; }
      finally { setDeletingBusy(false); saving.current = false; }
    };
  const reportDeletion=(id:string,state:DeletionState)=>setDeletions(current=>{const before=current[id];return before&&before.armed===state.armed&&before.busy===state.busy&&before.uncertain===state.uncertain?current:{...current,[id]:state};});
  const deleteAction=(target:TagResult,editor=false)=><DeleteAction key={target.id} excludeTag={target.id} disabled={busy||(deletionDirty&&!deletions[target.id]?.armed&&!deletions[target.id]?.uncertain)||(editor&&(uncertain||conflict))} label={editor?"삭제":`${target.name} 삭제`} message={`${target.name} 태그와 연결을 제거합니다. 원문은 보존합니다.`} onStateChange={state=>{reportDeletion(target.id,state);if(editor)setDeletionState(current=>current.armed===state.armed&&current.busy===state.busy&&current.uncertain===state.uncertain?current:state);}} onConfirm={(reason,tags,requestKey)=>deleteTag(target,reason,tags,requestKey)}/>;
  const editor=(initial:TagResult|null)=><form className="form tag-editor" aria-label={initial?"태그 이름 변경":"태그 추가"} onSubmit={e=>{e.preventDefault();void save();}}>
    <Field label={tagLabels.name} required error={fieldError}>{p=><input {...p} ref={input} className="input" placeholder="태그 이름" value={draft?.name??""} readOnly={busy||uncertain||deletionState.armed} onChange={e=>setDraft({initial,name:e.target.value})}/>}</Field>
    <div className="actions">
      <button type="submit" className="btn btn-primary" disabled={busy||conflict||deletionState.armed}>{writing?"저장 중…":uncertain?"같은 내용 다시 시도":initial?"저장":"추가"}</button>
      {draft&&<button type="button" className="btn btn-text" disabled={busy} onClick={()=>change(cancel)}>취소</button>}
      {initial&&deleteAction(initial,true)}
    </div>
    {failure&&<Notice kind="error">{failure}</Notice>}
  </form>;
  return <ModalShell open title={`${tagScopeLabels[scope]} 태그 관리`} headingLevel={1} previous={previous} dirty={dirty} busy={busy} onClose={close} onRouteDiscard={()=>{setDraft(null);setDeletions({});attempt.reset();}}>
    <div className="tag-management">
    {!draft?.initial&&editor(null)}
    {notice && <Notice>{notice}</Notice>}
    {error && <><Notice kind="error">{error}</Notice><button className="btn" disabled={loading} onClick={() => setRetry(n => n + 1)}>목록 다시 시도</button></>}
    {loading && <p className="secondary" role="status">불러오는 중…</p>}
    {page?.items.length === 0 && <p className="secondary">아직 태그가 없습니다.</p>}
    <ul className="list">{(draft?.initial&&!page?.items.some(t=>t.id===draft.initial?.id)?[draft.initial,...(page?.items??[])]:page?.items??[]).map(t=><li key={t.id} className="list-item">
      {draft?.initial?.id===t.id?editor(t):<><span className="item-title">{t.name}</span><div className="actions">
        <button id={`tag-${t.id}`} className="btn btn-text" disabled={busy} aria-label={`${t.name} 이름 변경`} onClick={()=>select(t)}>이름 변경</button>
        {deleteAction(t)}
      </div></>}
    </li>)}</ul>
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

    </div>
  </ModalShell>;
}
