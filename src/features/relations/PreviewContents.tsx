import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import type { EntityResult } from "@contracts/entity.ts";
import { entityLabels } from "@contracts/entity.ts";
import { taskLabels, type TaskResult } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import type { WorkspacePrinciple } from "../principles/model.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { TagNames } from "../tags/TagPicker.tsx";
import { StatusBadge } from "../activity/shared.tsx";
import { ChangeContext } from "../activity/ChangeContext.tsx";

export type Preview = EntityResult | TaskResult | RecordResult | WorkspacePrinciple;
export type PreviewKind = "entities" | "tasks" | "records" | "principles";
export function previewKind(path: string): PreviewKind | undefined {
  const kind = path.split("/")[1];
  return kind === "entities" || kind === "tasks" || kind === "records" || kind === "principles" ? kind : undefined;
}
export function previewViewable(kind: PreviewKind, item: Preview) {
  return kind !== "principles" || (item as WorkspacePrinciple).is_current;
}
/** Domain read adapters own content; disclosure and request lifetimes do not know its fields. */
export function PreviewContents({kind,item,main,onTagsReady}: {
  kind: PreviewKind; item: Preview; main: boolean; onTagsReady: (ready: boolean) => void;
}) {
  if (kind === "entities") {
    const entity = item as EntityResult;
    return <><p className="secondary">{entityIdentityLabel(entity)}{entity.deleted_at ? " · 삭제됨" : ""}</p><dl className="props entity-preview-properties">{(["prop2","prop3","prop4"] as const).map(key=>entity[key]!==null&&<div key={key}><dt>{entityLabels[key]}</dt><dd>{entity[key]}</dd></div>)}</dl><TagNames compact scope="entity" ids={entity.tag_ids} onReadyChange={onTagsReady}/></>;
  }
  if (kind === "tasks") {
    const task = item as TaskResult;
    return <>{task.body&&<MarkdownContent text={task.body}/>}{(!main||task.due_on)&&<dl className="props">{!main&&<div><dt>상태</dt><dd><StatusBadge status={task.status}/></dd></div>}{task.due_on&&<div><dt>{taskLabels.due_on}</dt><dd>{task.due_on}</dd></div>}</dl>}<TagNames compact scope="task" ids={task.tag_ids} onReadyChange={onTagsReady}/></>;
  }
  if (kind === "records") {
    const record = item as RecordResult;
    return <>{record.body&&<MarkdownContent text={record.body}/>} {main&&<ChangeContext record={record} compact/>}<TagNames compact scope="record" ids={record.tag_ids} onReadyChange={onTagsReady}/></>;
  }
  const principle = item as WorkspacePrinciple;
  return principle.body ? <MarkdownContent text={principle.body}/> : null;
}
