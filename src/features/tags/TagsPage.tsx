import {tagCreate,tagLabels,type TagResult} from "@contracts/tag.ts";
import {useEffect,useRef,useState} from "react";
import {FormModal} from "../../components/ContentForm.tsx";
import {Field,Notice} from "../../components/Field.tsx";
import {ConfirmDialog} from "../../components/Modal.tsx";
import {api,ApiError} from "../../lib/api.ts";
import {useRequestId} from "../../lib/useRequestId.ts";
import {fieldErrors} from "../../lib/format.ts";
type Page={items:TagResult[];next_cursor:string|null};
export function TagsPage() {
  const [page,setPage]=useState<Page|null>(null),[error,setError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null);
  const [form,setForm]=useState<TagResult|"create"|null>(null),[deleting,setDeleting]=useState<TagResult|null>(null);
  const pageCount=useRef(1),restoreFocus=useRef<string|null>(null);
  useEffect(()=>{let alive=true;setError(null);setPage(null);
    const load=async()=>{let loaded:Page={items:[],next_cursor:null};for(let i=0;i<pageCount.current;i++){
      const p:Page=await api<Page>("GET",`/tags${loaded.next_cursor?`?cursor=${encodeURIComponent(loaded.next_cursor)}`:""}`);
      if(!alive)return;loaded={items:[...loaded.items,...p.items],next_cursor:p.next_cursor};if(!p.next_cursor)break;
    }if(alive)setPage(loaded);};
    load().catch(()=>{if(alive)setError("태그를 불러오지 못했습니다.");});
    return()=>{alive=false;};},[retry]);
  useEffect(()=>{if(page&&restoreFocus.current){document.getElementById(`tag-${restoreFocus.current}`)?.focus();restoreFocus.current=null;}},[page]);
  return <section className="panel" aria-labelledby="tags-title">
    <div className="panel-head"><h1 id="tags-title" className="page-title">태그</h1><button className="btn btn-primary" onClick={()=>setForm("create")}>태그 추가</button></div>
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    {!page&&!error&&<p role="status" className="secondary">불러오는 중…</p>}
    {page?.items.length===0&&<p className="secondary">아직 태그가 없습니다.</p>}
    <ul className="list">{page?.items.map(t=><li key={t.id} className="list-item"><span className="item-title">{t.name}</span><div className="actions">
      <button id={`tag-${t.id}`} className="btn" aria-label={`${t.name} 이름 변경`} onClick={()=>setForm(t)}>이름 변경</button>
      <button className="btn btn-danger" aria-label={`${t.name} 삭제`} onClick={()=>setDeleting(t)}>삭제</button></div></li>)}</ul>
    {page?.next_cursor&&<button className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError(null);try{
      const next=await api<Page>("GET",`/tags?cursor=${encodeURIComponent(page.next_cursor!)}`);
      setPage({items:[...page.items,...next.items],next_cursor:next.next_cursor});
      pageCount.current++;
    }catch{setError("다음 태그를 불러오지 못했습니다.");}finally{setBusy(false);}}}>{busy?"불러오는 중…":"더 보기"}</button>}
    {form&&<TagForm initial={form==="create"?null:form} onClose={refresh=>{if(refresh){restoreFocus.current=form==="create"?null:form.id;setRetry(n=>n+1);}setForm(null);}} onSaved={()=>{restoreFocus.current=form==="create"?null:form.id;setForm(null);setRetry(n=>n+1);}}/>}
    {deleting&&<ConfirmDialog title="태그를 삭제할까요?" open busy={busy} danger message={`${deleting.name} 태그와 연결을 제거합니다. 항목의 원문은 보존합니다.`} confirmLabel="삭제" onCancel={()=>setDeleting(null)} onConfirm={async()=>{
      setBusy(true);setActionError(null);try{await api("DELETE",`/tags/${deleting.id}?expected_version=${deleting.version}`);setDeleting(null);setRetry(n=>n+1);}
      catch(e){setActionError(e instanceof ApiError?e.message:"태그를 삭제하지 못했습니다.");setDeleting(null);setRetry(n=>n+1);}finally{setBusy(false);}
    }}/>}
  </section>;
}
function TagForm({initial,onClose,onSaved}:{initial:TagResult|null;onClose:(refresh:boolean)=>void;onSaved:()=>void}) {
  const [name,setName]=useState(initial?.name??"");const request=useRequestId();
  const conflict=useRef(false);
  return <FormModal open title={initial?"태그 이름 변경":"태그 추가"} submitLabel="저장" dirty={name!==(initial?.name??"")} onClose={()=>onClose(conflict.current)}
    validate={()=>{const r=tagCreate.safeParse({name});return r.success?null:fieldErrors(r.error.issues);}}
    onSubmit={async()=>{const clean=tagCreate.parse({name});try{await api(initial?"PATCH":"POST",initial?`/tags/${initial.id}`:"/tags",initial?{name:clean.name,expected_version:initial.version}:{...clean,request_id:request.current});onSaved();}
      catch(e){if(e instanceof ApiError&&e.code==="conflict")conflict.current=true;throw e;}}}>
    {errors=><Field label={tagLabels.name} error={errors.name} help="1~30자, 같은 이름은 대소문자를 구분하지 않습니다.">{p=><input {...p} className="input" value={name} onChange={e=>setName(e.target.value)}/>}</Field>}
  </FormModal>;
}
