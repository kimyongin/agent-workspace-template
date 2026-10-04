import type { RecordResult } from "@contracts/record.ts";
import { Link } from "react-router";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { formatDateTime } from "../../lib/format.ts";

export type WorkspaceRecord = RecordResult & {
  record_kind: "user" | "result" | "change";
  change_note: string | null;
  applied_principle_snapshots: Record<string,unknown>[];
  change: null | { event_id: string; target_kind:"entity"|"task"|"record"|"principle";target_id:string;target_title:string;action:"create"|"update"|"delete"|"stop"|"resume";source:"http"|"mcp";before:Record<string,unknown>|null;after:Record<string,unknown>|null;path:string|null };
};
export const recordKindNames = {user:"직접 작성",result:"수행 결과",change:"변경 기록"};
const actions = {create:"등록",update:"수정",delete:"삭제",stop:"중단",resume:"재개"};
const targets = {entity:"엔터티",task:"할 일",record:"기록",principle:"원칙"};
export function ChangeContext({record,compact=false}: {record: WorkspaceRecord;compact?:boolean}) {
  const change=record.change;
  return <div className="form">
    <span className="meta">{recordKindNames[record.record_kind]??"기록"}{change?` · ${change.source==="http"?"웹":"에이전트"}`:""}</span>
    {record.change_note&&<p className="notice">편집 메모: {record.change_note}</p>}
    {change&&<>
      <p className="secondary">{targets[change.target_kind]} 「{change.target_title}」 · {actions[change.action]}{change.path?"":" · 삭제된 대상"}</p>
      {!compact&&<><div className="change-snapshot"><section><h2 className="section-title">변경 전</h2><pre>{change.before?JSON.stringify(change.before,null,2):"없음"}</pre></section><section><h2 className="section-title">변경 후</h2><pre>{change.after?JSON.stringify(change.after,null,2):"없음"}</pre></section></div>
        {change.path&&<Link className="btn" to={change.path}>대상 원문 보기</Link>}
        <p className="help">이 기록의 정정·삭제는 대상의 업무 상태를 되돌리지 않습니다.</p></>}
    </>}
  </div>;
}
export function PrincipleSnapshots({snapshots}: {snapshots:Record<string,unknown>[]}) {
  return <section className="form"><h2 className="section-title">적용 당시 원칙</h2>
    {!snapshots.length&&<p className="secondary">없음</p>}
    {snapshots.map((p,index)=><section key={index} className="form"><h3 className="section-title">{String(p.title??"원칙")}</h3>{typeof p.saved_at==="string"&&<p className="meta">저장 {formatDateTime(p.saved_at)}</p>}<p className="secondary">{String(p.summary??"")}</p><MarkdownContent text={String(p.body??"")}/>{p.captured_at==="migration"&&<p className="help">기존 자료 이관 때 보존한 본문입니다. 실제 판단 당시의 본문을 보증하지 않습니다.</p>}</section>)}
    {!!snapshots.length&&<p className="help">기록에 보존한 본문입니다. 이후 원칙 정정·삭제와 별도로 보존됩니다.</p>}
  </section>;
}
