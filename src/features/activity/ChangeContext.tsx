import type { RecordResult } from "@contracts/record.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";

export type WorkspaceRecord = RecordResult;
export const recordKindNames = {user:"직접 작성",result:"수행 결과",change:"변경 기록"};
export const changeActionNames = {create:"등록",update:"수정",delete:"삭제",restore:"복원",stop:"중단",resume:"재개"};
const targets = {entity:"엔터티",task:"할 일",record:"기록",principle:"원칙"};
export function ChangeContext({record,compact=false}: {record: WorkspaceRecord;compact?:boolean}) {
  const { formatDateTime } = useDisplayTime();
  const change=record.change;
  const kind=`${recordKindNames[record.record_kind]??"기록"}${change?` · ${change.source==="http"?"웹":"에이전트"}`:""}`;
  const target=change?`${targets[change.target_kind]} 「${change.target_title}」 · ${changeActionNames[change.action]}`:null;
  if(compact)return <><span className="meta">{kind}</span>{target&&<p className="secondary record-change-target">{target}{change?.action==="delete"?" · 삭제된 대상":""}</p>}</>;
  return <div className="record-context">
    <div className="record-context-meta"><span>{kind}</span><time dateTime={record.occurred_at}>{formatDateTime(record.occurred_at)}</time></div>
    {change&&<>
      {(change.before!==null||change.after!==null)&&<details className="workspace-additional"><summary>변경 전후 값</summary><div className="change-snapshot"><section><h3 className="section-title">변경 전</h3><pre>{change.before?JSON.stringify(change.before,null,2):"없음"}</pre></section><section><h3 className="section-title">변경 후</h3><pre>{change.after?JSON.stringify(change.after,null,2):"없음"}</pre></section></div></details>}
    </>}
  </div>;
}
export function PrincipleSnapshots({snapshots}: {snapshots:NonNullable<WorkspaceRecord["applied_principle_snapshots"]>}) {
  const { formatDateTime } = useDisplayTime();
  if (!snapshots.length) return null;
  return <section className="detail-section"><h2 className="section-title">적용 당시 원칙</h2>
    {snapshots.map((p,index)=><details key={index} className="workspace-additional">
      <summary>{p.title}</summary><div className="historical-document">
      <p className="meta">저장 {formatDateTime(p.saved_at)}</p>
      <p className="secondary">{p.summary}</p><MarkdownContent text={p.body}/>
      {p.captured_at==="migration"?<p className="help">기존 자료 이관 때 보존한 본문입니다. 실제 판단 당시의 본문을 보증하지 않습니다.</p>:<p className="help">업무 적용 시 보존한 본문입니다.</p>}
    </div></details>)}
    <p className="help">기록에 보존한 본문입니다. 이후 원칙 변경·삭제와 별도로 보존됩니다.</p>
  </section>;
}
