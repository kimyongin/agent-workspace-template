import { principleLabels, type PrincipleResult } from "@contracts/principle.ts";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PrincipleFormModal, emptyPrinciple } from "./forms.tsx";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import {TagFilter,TagNames,TagReadProvider, useTagDictionary} from "../tags/TagPicker.tsx";
import {EntityPicker} from "../entity/EntityPicker.tsx";

import {useActivityList} from "../activity/useActivityList.ts";
import "../activity/activity.css";
export function PrinciplesPage() {
  const tagDictionary = useTagDictionary(true,true);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const tag_id=params.get("tag_id")??"";
  const entity_id=params.get("entity_id")??"";
  const list = useActivityList<PrincipleResult>("principles", `/principles${query({status,tag_id,entity_id,limit:20})}`, "principles-title", "원칙을 불러오지 못했습니다. 다시 시도하세요.", tagDictionary.tags !== null || tagDictionary.failed);
  const {items,cursor,error,busy:loadingMore,more} = list;
  const [creating,setCreating] = useState(false);
  const navigate = useNavigate();
  const navigateAfterClose = useDeferredNavigation();
  return <section className="panel" aria-labelledby="principles-title">
    <div className="panel-head"><h1 id="principles-title" className="page-title" tabIndex={-1}>원칙</h1>
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>원칙 추가</button></div>
    <div className="activity-filters" role="group" aria-label="원칙 필터">
    <Field label="원칙 상태">{(p) => <select {...p} className="input" value={status} disabled={loadingMore}
      onChange={(e) => setParams({ status: e.target.value,tag_id,entity_id })}>
      <option value="active">활성</option><option value="inactive">비활성</option>
    </select>}</Field>
    <TagFilter dictionary={tagDictionary} value={tag_id} onChange={id=>setParams({status,tag_id:id,entity_id})}/>
    <EntityPicker label="엔터티 필터" value={entity_id} onChange={id=>setParams({status,tag_id,entity_id:id??""})}/>
    {(status!=="active" || tag_id || entity_id) && <button className="btn filter-reset" onClick={() => setParams({}, {replace:true})}>필터 해제</button>}
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {!items && !error && <p role="status" className="secondary">불러오는 중…</p>}
    {items?.length === 0 && <p className="secondary">이 조건에 해당하는 원칙이 없습니다.</p>}
    {items && <TagReadProvider dictionary={tagDictionary} enabled={items.some(p=>p.tag_ids.length>0)}><ul className="list">{items.map((p) => <li key={p.id} className="list-item"><div className="list-item-main">
      <div className="activity-item-heading"><Link {...list.link(p.id)} className="item-title">{p.title}</Link><span className="activity-item-actions"><Link {...list.link(p.id)} id={undefined} aria-label={`${p.title} 보기`}>보기</Link><Link {...list.link(p.id,true)} aria-label={`${p.title} 편집`}>편집</Link></span></div>
      <span className="secondary">{p.summary}</span><span className="meta">{principleLabels[p.status]}</span><TagNames ids={p.tag_ids} compact />
    </div></li>)}</ul></TagReadProvider>}
    {list.showMoreControl && <button id="activity-principles-page-control" type="button" className="btn" aria-disabled={loadingMore || (!cursor&&!error)} onClick={error?list.retry:more}>{loadingMore?"불러오는 중…":error?"다시 시도":cursor?"더 보기":"모두 불러왔습니다"}</button>}
    {creating && <CreatePrinciple onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigateAfterClose(`/principles/${id}`); }} />}
  </section>;
}

function CreatePrinciple({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const request = useRequestId();
  return <PrincipleFormModal initial={emptyPrinciple} onClose={onClose} onRouteDiscard={onClose} onSave={async draft => {
    const result = await api<PrincipleResult>("POST","/principles",{...draft,request_id:request.current});
    request.renew(); onCreated(result.id);
  }}/>;
}
