import { useState } from "react";
import { entityIdentitySettings, type EntityIdentitySettings as IdentitySettings } from "@contracts/entity-identity.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { identitySettingsDraft, orderedSources as ordered } from "./business-settings-drafts.ts";
import { BodyAction } from "../../components/BodyAction.tsx";

export function EntityIdentitySettings({onStateChange}: {onStateChange?: (state: {dirty:boolean;busy:boolean})=>void}) {
  const editor = useSettingsDraft(identitySettingsDraft,onStateChange);
  const {saved,draft,dirty,busy,conflict}=editor;
  const [notice,setMessage]=useState("");
  const [localError,setError]=useState(false);
  const [focusCode,setFocusCode]=useState("");
  const savedIdentity=saved?identitySettingsDraft.toDraft(saved):identitySettingsDraft.initial;
  const error=localError||!!editor.error;
  const message=editor.error?(editor.operation==="read"?"식별자 설정을 불러오지 못했습니다.":editor.error instanceof Error?editor.error.message:"저장하지 못했습니다. 입력은 유지했습니다."):notice;
  const setDraft=(update:(current:IdentitySettings)=>IdentitySettings)=>editor.resource.edit(update);
  const read=async()=>{const refreshing=!!saved;setMessage("");setError(false);if(await editor.resource.read())setMessage(refreshing?"최신 설정을 확인했습니다. 입력과 순서는 유지했습니다.":"");};
  const active=draft?.sources.filter(source=>!source.deleted)??[];
  const update=(code:string,patch:Partial<IdentitySettings["sources"][number]>)=>{setDraft(current=>current&&ordered(current.sources.map(source=>source.code===code?{...source,...patch}:source),current));setMessage("");};
  const move=(code:string,direction:number)=>setDraft(current=>{
    if(!current)return current;
    const sources=[...current.sources],indices=sources.map((source,index)=>source.deleted?-1:index).filter(index=>index>=0);
    const at=indices.findIndex(index=>sources[index].code===code),next=at+direction;
    if(next<0||next>=indices.length)return current;
    [sources[indices[at]],sources[indices[next]]]=[sources[indices[next]],sources[indices[at]]];
    return ordered(sources,current);
  });
  const remove=(code:string)=>setDraft(current=>{
    if(!current||active.length<=1)return current;
    const persisted=savedIdentity.sources.some(source=>source.code===code);
    const sources=persisted?current.sources.map(source=>source.code===code?{...source,deleted:true}:source):current.sources.filter(source=>source.code!==code);
    return ordered(sources,current);
  });
  return <section className="settings-section" aria-labelledby="entity-identity-title">
    <h2 className="settings-section-title" id="entity-identity-title">엔터티 식별자</h2>
    {message&&<p className={error?"error-text":"secondary"} role={error?"alert":"status"}>{message}</p>}
    {!saved&&<><p role="status">{message?"":"설정을 읽는 중…"}</p>{message&&<button className="btn" disabled={busy} onClick={()=>void read()}>다시 시도</button>}</>}
    {draft&&saved&&<form className="form" aria-label="엔터티 식별자 설정" aria-busy={busy} onSubmit={async event=>{
      event.preventDefault();if(busy||!dirty)return;
      const parsed=entityIdentitySettings.safeParse(draft);
      if(!parsed.success){setMessage(parsed.error.issues.map(issue=>issue.message).join(" · "));setError(true);return;}
      setMessage("");setError(false);
      if(await editor.resource.save())setMessage("식별자 설정을 저장했습니다.");
    }}><fieldset disabled={busy} className="form plain-fieldset">
      <div className="settings-source-heading"><h3>발급처 목록 ({active.length}개)</h3><BodyAction icon="create" disabled={draft.sources.length>=32} onClick={()=>{
        const code=`issuer_${crypto.randomUUID().replaceAll("-","").slice(0,16)}`;
        setDraft(current=>current&&ordered([...current.sources,{code,label:"",generation:"short"}],current));setFocusCode(code);setMessage("");
      }}>추가</BodyAction></div>
      <div className="settings-source-list">{active.map((source,index)=><div className="settings-source-row" key={source.code}>
        <div className="settings-source-fields">
          <div className={`settings-source-name${index===0?" is-default":""}`}><input ref={input=>{if(input&&focusCode===source.code){input.focus();setFocusCode("");}}} aria-label={`발급처 ${index+1} 이름`} className="input" placeholder="발급처 이름 입력" value={source.label} onChange={event=>update(source.code,{label:event.target.value})}/>{index===0&&<span className="badge settings-source-default">기본</span>}</div>
          <select aria-label={`발급처 ${index+1} 방식`} className="input" value={source.generation} onChange={event=>update(source.code,{generation:event.target.value as "short"|"manual"})}><option value="short">자동 발급</option><option value="manual">직접 입력</option></select>
        </div>
        <div className="settings-source-actions">
          <button type="button" className="btn btn-text item-icon" aria-label={`${source.label||"새 발급처"} 위로 이동`} title="위로 이동" disabled={index===0} onClick={()=>move(source.code,-1)}><MoveIcon up/></button>
          <button type="button" className="btn btn-text item-icon" aria-label={`${source.label||"새 발급처"} 아래로 이동`} title="아래로 이동" disabled={index===active.length-1} onClick={()=>move(source.code,1)}><MoveIcon/></button>
          <BodyAction aria-label={`${source.label||"새 발급처"} 삭제`} disabled={active.length<=1} onClick={()=>remove(source.code)}>삭제</BodyAction>
        </div>
      </div>)}</div>
      <p className="help">자동 발급은 날짜와 랜덤 8자로 구성된 식별자를 만들고, 직접 입력은 사용자가 식별자를 입력합니다.</p>
      {draft.sources.some(source=>source.deleted)&&<details className="settings-source-retired"><summary>삭제된 발급처 ({draft.sources.filter(source=>source.deleted).length}개)</summary>{draft.sources.filter(source=>source.deleted).map(source=><div className="settings-source-row" key={source.code}><span>{source.label}</span><BodyAction aria-label={`${source.label} 복원`} onClick={()=>{setDraft(current=>current&&ordered([...current.sources.filter(value=>value.code!==source.code),{...source,deleted:false}],current));}}>복원</BodyAction></div>)}</details>}
      {conflict&&<button type="button" className="btn" onClick={()=>void read()}>최신값 확인</button>}
      <div className="settings-section-footer"><div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={()=>{editor.resource.reset();setMessage("");setError(false);}}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy?"저장 중…":"식별자 설정 저장"}</button></div></div>
    </fieldset></form>}
  </section>;
}
function MoveIcon({up=false}:{up?:boolean}) {return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up?"M12 19V5m-6 6 6-6 6 6":"M12 5v14m-6-6 6 6 6-6"}/></svg>;}
