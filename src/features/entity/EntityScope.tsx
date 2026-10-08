import { useEffect, useState } from "react";
import { id as entityId } from "@contracts/common.ts";
import { api } from "../../lib/api.ts";

/** Related-list URL scope uses owner-protected source data, never a URL display name. */
export function EntityScope({id,onClear}:{id:string;onClear:()=>void}) {
  const [name,setName]=useState<string|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  const valid=entityId.safeParse(id).success;
  useEffect(()=>{setName(null);setFailed(false);if(!valid)return;const controller=new AbortController();
    api<{prop1:string}>("GET",`/entities/${encodeURIComponent(id)}`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setName(value.prop1);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>controller.abort();},[id,valid,retry]);
  return <div className="entity-scope"><span role="status">{!valid?"엔터티 범위 ID가 올바르지 않습니다.":failed?"연결된 엔터티를 조회할 수 없습니다.":name?`연결된 엔터티: ${name}`:"연결된 엔터티를 불러오는 중…"}</span>
    {valid&&failed&&<button type="button" className="btn" onClick={()=>setRetry(n=>n+1)}>엔터티 다시 조회</button>}
    <button type="button" className="scope-clear" aria-label="엔터티 범위 해제" onClick={onClear}>×</button>
  </div>;
}
