import type {TagResult} from "@contracts/tag.ts";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {api} from "../../lib/api.ts";
import {Field,Notice} from "../../components/Field.tsx";
import "../activity/activity.css";

async function loadTags() {
    const all: TagResult[] = []; let cursor: string | null = null;
    do {
      const page: {items:TagResult[];next_cursor:string|null} = await api("GET", `/tags?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      all.push(...page.items); cursor = page.next_cursor;
    } while (cursor);
    return all;
}
export function useTagDictionary(enabled = true) {
  const [tags,setTags]=useState<TagResult[]|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{if(!enabled)return;let alive=true;setFailed(false);
    loadTags().then(all=>{if(alive)setTags(all);}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[retry,enabled]);
  return {tags,failed,retry:()=>setRetry(n=>n+1)};
}
export function TagPicker({value,onChange,error}:{value:string[];onChange:(ids:string[])=>void;error?:string}) {
  const {tags,failed,retry}=useTagDictionary();
  return <fieldset className="field" style={{border:0,padding:0,margin:0}}><legend className="label">태그</legend>
    <p className="help">최대 10개까지 선택합니다.</p>
    {error&&<p className="error-text">{error}</p>}
    {failed?<><Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice><button type="button" className="btn" onClick={retry}>태그 다시 시도</button></>:
      !tags?<p className="secondary" role="status">태그를 불러오는 중…</p>:
      <div className="chips tag-selection">{tags.map(t=><button type="button" className="chip" key={t.id} aria-pressed={value.includes(t.id)} disabled={!value.includes(t.id)&&value.length>=10}
        onClick={()=>onChange(value.includes(t.id)?value.filter(id=>id!==t.id):[...value,t.id])}>{t.name}</button>)}
        {value.filter(id=>!tags.some(t=>t.id===id)).map(id=><button type="button" className="chip" key={id} aria-pressed onClick={()=>onChange(value.filter(v=>v!==id))}>삭제된 태그 (선택 해제)</button>)}
        {!tags.length&&!value.length&&<span className="secondary">태그 관리에서 태그를 먼저 추가하세요.</span>}</div>}
    <button type="button" className="btn btn-text" disabled={!value.length} onClick={()=>onChange([])}>태그 선택 해제</button>
  </fieldset>;
}
export function TagFilter({value,onChange,dictionary}:{value:string;onChange:(id:string)=>void;dictionary?:ReturnType<typeof useTagDictionary>}) {
  const local = useTagDictionary(!dictionary);
  const {tags,failed,retry}=dictionary ?? local;
  return <><Field label="태그 필터">{p=><select {...p} className="input" value={value} onChange={e=>onChange(e.target.value)} disabled={!tags}>
    <option value="">모든 태그</option>{tags?.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    {value&&tags&&!tags.some(t=>t.id===value)&&<option value={value}>삭제된 태그</option>}
  </select>}</Field>{failed&&<><Notice kind="error">태그 필터를 불러오지 못했습니다.</Notice><button type="button" className="btn" onClick={retry}>태그 다시 시도</button></>}</>;
}
const TagReadContext = createContext<ReturnType<typeof useTagDictionary> | null>(null);
/** One lookup per visible list, with scope-local cancellation rather than a cross-owner cache. */
export function TagReadProvider({children,enabled=true,dictionary}:{children:ReactNode;enabled?:boolean;dictionary?:ReturnType<typeof useTagDictionary>}) {
  const local = useTagDictionary(enabled && !dictionary);
  const state = dictionary ?? local;
  // Unknown names can wrap to different heights. Reveal the initial tagged rows only after the lookup settles.
  if(enabled && !state.tags && !state.failed)return <p className="secondary" role="status">태그 이름을 불러오는 중…</p>;
  return <TagReadContext.Provider value={state}>{children}</TagReadContext.Provider>;
}
export function TagNames({ids, compact=false}:{ids:string[];compact?:boolean}) {
  const shared = useContext(TagReadContext);
  const local = useTagDictionary(ids.length > 0 && !shared);
  const {tags,failed,retry}=shared ?? local;
  if(compact && !ids.length)return null;
  return <div>{!compact && <h2 className="section-title">태그</h2>}{!ids.length?<p className="secondary">없음</p>:failed?<><Notice kind="error">태그 이름을 불러오지 못했습니다.</Notice><button className="btn" onClick={retry}>태그 다시 시도</button></>:
    !tags?(compact?<div className="chips" role="status">{ids.map(id=><span className="meta tag-read" key={id}>태그를 불러오는 중…</span>)}</div>:<p className="secondary" role="status">태그를 불러오는 중…</p>):<div className="chips" aria-label="태그">{ids.map(id=><span className="meta tag-read" key={id}>{tags.find(t=>t.id===id)?.name ?? "삭제된 태그"}</span>)}</div>}</div>;
}
