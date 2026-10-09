import { CollectionList } from "../../components/Collection.tsx";
import type { RecordResult } from "@contracts/record.ts";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import type { Preview } from "../relations/PreviewContents.tsx";
import { ApiError } from "../../lib/api.ts";
import { EntityLinkItem } from "../entity/EntityPicker.tsx";
import { RelatedTaskItem } from "./RelatedTask.tsx";


type Change = NonNullable<RecordResult["change"]>;
const groups = [
  {kind:"task",title:"할 일",route:"tasks"},
  {kind:"entity",title:"엔터티",route:"entities"},
  {kind:"principle",title:"원칙",route:"principles"},
  {kind:"record",title:"기록",route:"records"},
] as const;

/** Event targets and explicit relationships share one section and one card per kind/ID. */
export function RecordRelations({record}: {record:RecordResult}) {
  return <>{groups.map(group=>{
    const change=record.change?.target_kind===group.kind?record.change:null;
    const selected=group.kind==="entity"?record.entity_ids:group.kind==="task"&&record.task_id?[record.task_id]:[];
    const ids=[...new Set([...(change?[change.target_id]:[]),...selected])];
    if(!ids.length)return null;
    return <RelatedSection key={group.kind} title={group.title} count={ids.length}>
      <CollectionList>{ids.map(id=><li key={id}>
        {change?.target_id===id
          ?<ChangedRelation change={change} path={`/${group.route}/${encodeURIComponent(id)}`} occurrence={group.kind==="task"&&record.task_id===id?record.occurrence_on:null}/>
          :group.kind==="entity"?<EntityLinkItem id={id} context={record.entity_context}/>
          :group.kind==="task"?<RelatedTaskItem id={id} occurrence={record.occurrence_on}/>:null}
      </li>)}</CollectionList>
    </RelatedSection>;
  })}</>;
}

function ChangedRelation({change,path,occurrence}: {change:Change;path:string;occurrence:string|null}) {
  const read = useRelatedRead<Preview>(path, { probe: true });
  const probe = read.probe;
  const missingError = probe.error instanceof ApiError && probe.error.status === 404 && probe.error.code === "not_found";
  const value = probe.value;
  const state = probe.loading ? "loading" : probe.error ? missingError ? "missing" : "failed"
    : value ? "deleted_at" in value && value.deleted_at ? "missing" : "exists" : "loading";
  const missing=state==="missing";
  const deleted=missing&&change.action==="delete";
  const fallback=missing
    ?<p className="secondary">{deleted?"삭제된 항목입니다. 기록에 저장된 당시 제목을 표시합니다.":"현재 항목을 조회할 수 없습니다. 기록에 저장된 당시 제목을 표시합니다."}</p>
    :state==="failed"
    ?<><p className="secondary">현재 항목을 불러오지 못했습니다.</p><button type="button" className="btn" onClick={()=>void read.resource.read("probe")}>다시 시도</button></>
    :state==="loading"?<p className="secondary" role="status">불러오는 중…</p>:undefined;
  return <RelatedPreviewItem resource={read.resource} to={path} restoreKey="change-target" title={change.target_title}
    titleBadge={missing?<span className="badge">{deleted?"삭제됨":"조회 불가"}</span>:undefined}
    metadata={occurrence?<span className="meta">{occurrence} 회차</span>:undefined}
    fallback={fallback}/>;
}
