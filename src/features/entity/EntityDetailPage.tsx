import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect,useState } from "react";
import { Link,useNavigate,useParams,useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { api,ApiError,query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { EntityForm } from "./forms.tsx";
export function EntityDetailPage() {
  const {id}=useParams(),[params]=useSearchParams(),navigate=useNavigate();
  const [entity,setEntity]=useState<EntityDetail|null>(null),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0),[editing,setEditing]=useState(false),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();setEntity(null);setError(null);api<EntityDetail>("GET",`/entities/${id}`,undefined,controller.signal).then(setEntity).catch(e=>{if(!controller.signal.aborted)setError(e instanceof ApiError?e.message:"엔터티를 불러오지 못했습니다.");});return()=>controller.abort();},[id,retry]);
  const back=`/entities?${params}${id?`#entity-${id}`:""}`;
  return <section className="panel"><Link className="action-link" to={back}>← 엔터티 목록</Link>
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {!entity&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
    {entity&&<><div className="panel-head"><h1 className="page-title">{entity.prop1}</h1><div className="actions"><button className="btn" onClick={()=>setEditing(true)}>편집</button><button className="btn btn-danger" onClick={()=>setDeleting(true)}>삭제</button></div></div>
      <dl><dt className="label">속성 2</dt><dd className="value">{entity.prop2??"미지정"}</dd><dt className="label">속성 3</dt><dd className="value">{entity.prop3??"미지정"}</dd><dt className="label">속성 4</dt><dd className="value">{entity.prop4}</dd></dl>
      <p className="meta">수정 {formatDateTime(entity.updated_at)} · 버전 {entity.version}</p>
      {([["tasks","할 일"],["records","기록"],["principles","원칙"]] as const).map(([kind,label])=><section key={kind}><h2 className="section-title">연결된 {label} ({entity[kind].count}개)</h2>
        <Link to={`/${kind}${query({entity_id:id})}`}>전체 {label} 보기</Link>
        {entity[kind].count===0?<p className="secondary">연결된 {label}이 없습니다.</p>:<ul className="list">{entity[kind].items.map(item=><li className="list-item" key={item.id}><Link className="item-title" to={`/${kind}/${item.id}`}>{item.title}</Link></li>)}</ul>}
      </section>)}
      {editing&&<EntityForm initial={entity} onClose={()=>setEditing(false)} onSave={async value=>{await api("PATCH",`/entities/${id}`,{...value,expected_version:entity.version});setEditing(false);setRetry(n=>n+1);}}/>}
      {deleting&&<ConfirmDialog open title="엔터티를 삭제할까요?" message={`${entity.prop1}을 삭제하고 연결을 해제합니다. 할 일·기록·원칙 원문은 보존합니다.`} confirmLabel="삭제" danger busy={busy} onCancel={()=>setDeleting(false)} onConfirm={async()=>{setBusy(true);try{await api("DELETE",`/entities/${id}?expected_version=${entity.version}`);navigate(`/entities?${params}`);}catch(e){setError(e instanceof ApiError?e.message:"삭제하지 못했습니다.");setDeleting(false);}finally{setBusy(false);}}}/>}
    </>}
  </section>;
}
