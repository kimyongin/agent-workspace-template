import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Field } from "./Field.tsx";
import "./workspace.css";

export function TabSearch({entity=false}: {entity?: boolean}) {
  const [params,setParams]=useSearchParams();
  const name=entity?"keyword":"q", applied=params.get(name)??"";
  const [draft,setDraft]=useState(applied), composing=useRef(false);
  useEffect(()=>setDraft(applied),[applied]);
  const change=(name:string,value:string)=>{const p=new URLSearchParams(params);["pages","scroll","collapsed"].forEach(k=>p.delete(k));value?p.set(name,value):p.delete(name);setParams(p);};
  return <form className="workspace-search" onSubmit={e=>{e.preventDefault();if(!composing.current)change(name,draft.trim());}}>
    <Field label={entity?"속성 1 키워드":"검색어"} help={entity?"속성 1의 부분 일치, 최대 100자":"제목·요약·본문 키워드, 최대 200자. 자동 검색은 제목·요약 의미를 함께 찾습니다."}>
      {p=><input {...p} className="input" value={draft} onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault();}}/>}
    </Field>
    <div className="actions"><button type="submit" className="btn btn-primary">검색</button><button type="button" className="btn" disabled={!draft&&!applied} onClick={()=>{setDraft("");change(name,"");}}>검색어 지우기</button></div>
    {!entity&&<Field label="검색 방식">{p=><select {...p} className="input" value={params.get("mode")??"keyword"} onChange={e=>change("mode",e.target.value)}><option value="keyword">키워드</option><option value="auto">자동</option></select>}</Field>}
  </form>;
}

const names: Record<string,string>={q:"검색어",keyword:"속성 1 키워드",mode:"검색 방식",tag_id:"태그",entity_id:"연결 엔터티",kind:"할 일 종류",status:"상태",record_kind:"기록 종류",prop3_from:"시작 날짜",prop3_to:"끝 날짜",prop4:"속성 4",sort:"정렬",from:"기간 시작",to:"기간 끝"};
export function resetTabFilters(params: URLSearchParams) {
  return new URLSearchParams([...params].filter(([key])=>["q","keyword","mode"].includes(key)));
}
export function AppliedConditions({namesForIds={},excluded=[]}: {namesForIds?:Record<string,string>;excluded?:string[]}={}) {
  const [params,setParams]=useSearchParams();
  const conditions=[...params].filter(([key,value])=>names[key]&&value&&!excluded.includes(key));
  if(!conditions.length)return null;
  return <div className="workspace-conditions" aria-label="적용 조건"><span className="label">적용 조건</span>{conditions.map(([key,value])=><button key={key} className="chip" aria-label={`${names[key]} 해제`} onClick={()=>{const p=new URLSearchParams(params);p.delete(key);["pages","scroll","collapsed"].forEach(k=>p.delete(k));setParams(p);}}>{names[key]}: {key.endsWith("_id")?(namesForIds[value]??"선택됨"):value} ×</button>)}</div>;
}
