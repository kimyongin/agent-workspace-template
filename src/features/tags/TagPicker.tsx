import type {TagResult} from "@contracts/tag.ts";
import {useEffect,useState} from "react";
import {api} from "../../lib/api.ts";
import {Field,Notice} from "../../components/Field.tsx";
function useTags() {
  const [tags,setTags]=useState<TagResult[]|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{let alive=true;setFailed(false);
    const load=async()=>{const all:TagResult[]=[];let cursor:string|null=null;do{
      const p:{items:TagResult[];next_cursor:string|null}=await api("GET",`/tags?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
      if(!alive)return;all.push(...p.items);cursor=p.next_cursor;
    }while(cursor);if(alive)setTags(all);};
    load().catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[retry]);
  return {tags,failed,retry:()=>setRetry(n=>n+1)};
}
export function TagPicker({value,onChange,error}:{value:string[];onChange:(ids:string[])=>void;error?:string}) {
  const {tags,failed,retry}=useTags();
  return <fieldset className="field" style={{border:0,padding:0,margin:0}}><legend className="label">태그</legend>
    <p className="help">최대 10개까지 선택합니다.</p>
    {error&&<p className="error-text">{error}</p>}
    {failed?<><Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice><button type="button" className="btn" onClick={retry}>태그 다시 시도</button></>:
      !tags?<p className="secondary" role="status">태그를 불러오는 중…</p>:
      <div className="chips">{tags.map(t=><button type="button" className="chip" key={t.id} aria-pressed={value.includes(t.id)} disabled={!value.includes(t.id)&&value.length>=10}
        onClick={()=>onChange(value.includes(t.id)?value.filter(id=>id!==t.id):[...value,t.id])}>{t.name}</button>)}
        {value.filter(id=>!tags.some(t=>t.id===id)).map(id=><button type="button" className="chip" key={id} aria-pressed onClick={()=>onChange(value.filter(v=>v!==id))}>삭제된 태그 (선택 해제)</button>)}
        {!tags.length&&!value.length&&<span className="secondary">태그 관리에서 태그를 먼저 추가하세요.</span>}</div>}
  </fieldset>;
}
export function TagFilter({value,onChange}:{value:string;onChange:(id:string)=>void}) {
  const {tags,failed,retry}=useTags();
  return <><Field label="태그 필터">{p=><select {...p} className="input" value={value} onChange={e=>onChange(e.target.value)} disabled={!tags}>
    <option value="">모든 태그</option>{tags?.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    {value&&tags&&!tags.some(t=>t.id===value)&&<option value={value}>삭제된 태그</option>}
  </select>}</Field>{failed&&<><Notice kind="error">태그 필터를 불러오지 못했습니다.</Notice><button type="button" className="btn" onClick={retry}>태그 다시 시도</button></>}</>;
}
export function TagNames({ids}:{ids:string[]}) {
  const {tags,failed,retry}=useTags();
  return <div><h2 className="section-title">태그</h2>{!ids.length?<p className="secondary">없음</p>:failed?<><Notice kind="error">태그 이름을 불러오지 못했습니다.</Notice><button className="btn" onClick={retry}>태그 다시 시도</button></>:
    !tags?<p className="secondary" role="status">태그를 불러오는 중…</p>:<div className="chips">{tags.filter(t=>ids.includes(t.id)).map(t=><span className="meta" key={t.id}>{t.name}</span>)}</div>}</div>;
}
