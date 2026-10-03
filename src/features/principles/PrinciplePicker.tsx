import type { PrincipleResult } from "@contracts/principle.ts";
import {useEffect,useState} from "react";
import {api,ApiError} from "../../lib/api.ts";
import {Notice} from "../../components/Field.tsx";

export function PrinciplePicker({value,onChange,error}:{value:string[];onChange:(ids:string[])=>void;error?:string}) {
  const [options,setOptions]=useState<Pick<PrincipleResult,"id"|"title"|"status">[]|null>(null);
  const [failed,setFailed]=useState(false), [retry,setRetry]=useState(0);
  // 선택한 비활성 원칙도 유지한다. 선택 변경은 후보를 다시 불러오지 않는다.
  const [initial]=useState(value);
  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      setFailed(false);const all:PrincipleResult[]=[];let cursor:string|null=null;
      do{const p:{items:PrincipleResult[];next_cursor:string|null}=await api("GET",`/principles?status=active&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
        if(!alive)return;all.push(...p.items);cursor=p.next_cursor;
      }while(cursor);
      const missing=initial.filter(id=>!all.some(p=>p.id===id));
      const existing=await Promise.all(missing.map(async id=>{
        try{return await api<PrincipleResult>("GET",`/principles/${id}`);}
        catch(e){if(e instanceof ApiError && e.status===404)return {id,title:"삭제된 원칙 (선택 해제 필요)",status:"inactive" as const};throw e;}
      }));
      if(alive)setOptions([...all,...existing]);
    };
    load().catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};
  },[initial,retry]);
  return <fieldset className="field" style={{border:0,padding:0,margin:0}}>
    <legend className="label">적용한 원칙</legend>
    <p className="help">판단에 사용한 원칙을 선택합니다. 저장 후에도 원칙의 현재 상태를 확인할 수 있습니다.</p>
    {error&&<p className="error-text">{error}</p>}
    {failed?<><Notice kind="error">원칙을 불러오지 못했습니다. 현재 선택은 유지됩니다.</Notice><button type="button" className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>:
      !options?<p className="secondary" role="status">원칙을 불러오는 중…</p>:
      !options.length?<p className="secondary">선택할 활성 원칙이 없습니다.</p>:
      <div className="chips">{options.map(p=><button type="button" key={p.id} className="chip" aria-pressed={value.includes(p.id)}
        onClick={()=>onChange(value.includes(p.id)?value.filter(id=>id!==p.id):[...value,p.id])}>{p.title}{p.status==="inactive"?" (비활성)":""}</button>)}</div>}
  </fieldset>;
}
