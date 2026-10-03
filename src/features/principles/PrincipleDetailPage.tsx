import { principleLabels, type PrincipleResult } from "@contracts/principle.ts";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { PrincipleFormModal } from "./forms.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import {TagNames} from "../tags/TagPicker.tsx";
import {useSearchReturn} from "../search/return.ts";

export function PrincipleDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useSearchReturn(`/principles?${params}#principle-${id}`,"← 원칙 목록");
  const [item, setItem] = useState<PrincipleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<null|"edit"|"status"|"replace"|"delete">(null);
  const [busy,setBusy] = useState(false);
  const refreshOnClose = useRef(false);
  const closeDialog = () => {
    setDialog(null);
    if(refreshOnClose.current){refreshOnClose.current=false;setRetry(n=>n+1);}
  };
  const changedElsewhere = (e:unknown) => {
    if(e instanceof ApiError && e.code==="conflict") refreshOnClose.current=true;
  };
  useEffect(() => {
    let alive = true;
    setItem(null); setError(null);
    api<PrincipleResult>("GET", `/principles/${id}`).then((p) => { if (alive) setItem(p); })
      .catch((e) => { if (alive) setError(e instanceof ApiError && e.code === "not_found" ? "원칙을 찾을 수 없습니다." : "원칙을 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [id, retry]);
  return <section className="panel" aria-labelledby={item ? "principle-title" : undefined}>
    <Link className="secondary back-link" to={back.path}>{back.label}</Link>
    {error && <><Notice kind="error">{error}</Notice><button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>다시 시도</button></>}
    {!item && !error && <p role="status" className="secondary">불러오는 중…</p>}
    {item && <>
      <h1 id="principle-title" className="page-title">{item.title}</h1>
      <div className="actions">
        <button type="button" className="btn" onClick={()=>setDialog("edit")}>편집</button>
        <button type="button" className="btn" onClick={()=>setDialog("status")}>{item.status==="active"?"비활성화":"활성화"}</button>
        {item.status==="inactive"&&<button type="button" className="btn" onClick={()=>setDialog("replace")}>대체 연결 변경</button>}
        <button type="button" className="btn btn-danger" onClick={()=>setDialog("delete")}>삭제</button>
      </div>
      <dl className="props"><div><dt>상태</dt><dd>{principleLabels[item.status]}</dd></div>
        <div><dt>{principleLabels.applies_when}</dt><dd>{item.applies_when || "지정하지 않음"}</dd></div>
        <div><dt>{principleLabels.summary}</dt><dd>{item.summary}</dd></div></dl>
      <TagNames ids={item.tag_ids}/>
      <div><h2 className="section-title">본문</h2><MarkdownContent text={item.body} /></div>
      <p className="meta">수정 {formatDateTime(item.updated_at)}</p>
      {item.replaced_by_id&&<p><Link to={`/principles/${item.replaced_by_id}`}>대체 원칙 확인</Link></p>}
      {dialog==="edit"&&<PrincipleFormModal editing initial={item} onClose={closeDialog} onSave={async draft=>{
        try {setItem(await api<PrincipleResult>("PATCH",`/principles/${id}`,{...draft,expected_version:item.version}));setDialog(null);}
        catch(e){changedElsewhere(e);throw e;}
      }}/>}
      {(dialog==="status"||dialog==="replace")&&<StatusForm replaceOnly={dialog==="replace"} item={item} onClose={closeDialog} onError={changedElsewhere} onSave={p=>{setItem(p);setDialog(null);}}/>}
      <ConfirmDialog open={dialog==="delete"} title="원칙을 삭제할까요?" message="연결된 판단 기록의 본문은 보존하고 원칙 연결만 제거합니다."
        confirmLabel="삭제" danger busy={busy} onCancel={()=>setDialog(null)} onConfirm={async()=>{
          setBusy(true);setError(null);
          try {await api("DELETE",`/principles/${id}?expected_version=${item.version}`);navigate(back.path,{replace:true});}
          catch(e){setError(e instanceof ApiError?e.message:"삭제하지 못했습니다.");setDialog(null);}
          finally{setBusy(false);}
        }}/>
    </>}
  </section>;
}

function StatusForm({item,onClose,onSave,onError,replaceOnly=false}:{item:PrincipleResult;replaceOnly?:boolean;onClose:()=>void;onError:(e:unknown)=>void;onSave:(p:PrincipleResult)=>void}) {
  const [replacement,setReplacement]=useState(item.replaced_by_id??"");
  const [options,setOptions]=useState<PrincipleResult[]|null>(null);
  const [failed,setFailed]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(item.status==="inactive"&&!replaceOnly){setOptions([]);return;}
    let alive=true;
    const load=async()=>{
      setFailed(false);const all:PrincipleResult[]=[];let cursor:string|null=null;
      do {const p: {items:PrincipleResult[];next_cursor:string|null}=await api("GET",`/principles?status=active&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
        if(!alive)return;all.push(...p.items);cursor=p.next_cursor;
      }while(cursor);
      setOptions(all.filter(p=>p.id!==item.id));
    };
    load().catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};
  },[item.id,item.status,replaceOnly,attempt]);
  const deactivating=item.status==="active"||replaceOnly;
  return <FormModal title={replaceOnly?"대체 연결 변경":item.status==="active"?"원칙 비활성화":"원칙 활성화"} open submitLabel="변경" dirty={replacement!==(item.replaced_by_id??"")} onClose={onClose}
    validate={()=>deactivating&&(failed||!options)?{replaced_by_id:"원칙 목록을 불러온 뒤 다시 시도하세요."}:null}
    onSubmit={async()=>{try{onSave(await api<PrincipleResult>("POST",`/principles/${item.id}/${deactivating?"deactivate":"activate"}`,
      {expected_version:item.version,...(deactivating?{replaced_by_id:replacement||null}:{})}));}catch(e){onError(e);throw e;}}}>
    {errors=><>
      <p className="help">{replaceOnly?"비활성 원칙의 대체 연결을 변경합니다.":`현재 원칙을 ${item.status==="active"?"비활성화":"활성화"}합니다.`} 과거 기록과 원문은 남습니다.</p>
      {failed&&<><Notice kind="error">원칙 목록을 불러오지 못했습니다.</Notice><button type="button" className="btn" onClick={()=>setAttempt(n=>n+1)}>다시 시도</button></>}
      {deactivating&&<Field label="대체 원칙" error={errors.replaced_by_id} help="의미가 바뀌었다면 새 원칙을 먼저 만들고 연결하세요.">
        {p=><select {...p} className="input" value={replacement} disabled={!options} onChange={e=>setReplacement(e.target.value)}>
          <option value="">없음</option>
          {item.replaced_by_id&&!options?.some(p=>p.id===item.replaced_by_id)&&<option value={item.replaced_by_id}>현재 대체 원칙</option>}
          {options?.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}
        </select>}
      </Field>}
    </>}
  </FormModal>;
}
