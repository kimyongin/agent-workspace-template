import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { EntityProperties } from "../entity/EntityProperties.tsx";
import { taskLabels, type TaskResult } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { TagNames } from "../tags/TagPicker.tsx";
import { StatusBadge } from "../activity/shared.tsx";
import { ChangeContext } from "../activity/ChangeContext.tsx";

export type Preview = EntityDetail | TaskResult | RecordResult;
export type PreviewKind = "entities" | "tasks" | "records";
export function previewKind(path: string): PreviewKind | undefined {
  const kind = path.split("/")[1];
  return kind === "entities" || kind === "tasks" || kind === "records" ? kind : undefined;
}
/** Domain read adapters own content; disclosure and request lifetimes do not know its fields. */
export function PreviewContents({ kind, item, main, onTagsReady, onPropertiesReady }: {
  kind: PreviewKind;
  item: Preview;
  main: boolean;
  onTagsReady: (ready: boolean) => void;
  onPropertiesReady: (ready: boolean) => void;
}) {
  if (kind === "entities") {
    const entity = item as EntityDetail;
    return (
      <>
        <p className="secondary">{entityIdentityLabel(entity)}{entity.deleted_at ? " · 삭제됨" : ""}</p>
        <p>{entity.type.label}</p>
        <EntityProperties entity={entity} onReadyChange={onPropertiesReady} />
        <TagNames compact scope="entity" ids={entity.tag_ids} onReadyChange={onTagsReady} />
      </>
    );
  }
  if (kind === "tasks") {
    const task = item as TaskResult;
    return (
      <>
        {task.body && <MarkdownContent text={task.body} />}
        {(!main || task.due_on) && (
          <dl className="props">
            {!main && (
              <div>
                <dt>상태</dt>
                <dd>
                  <StatusBadge status={task.status} />
                </dd>
              </div>
            )}
            {task.due_on && (
              <div>
                <dt>{taskLabels.due_on}</dt>
                <dd>{task.due_on}</dd>
              </div>
            )}
          </dl>
        )}
        <TagNames compact scope="task" ids={task.tag_ids} onReadyChange={onTagsReady} />
      </>
    );
  }
  if (kind === "records") {
    const record = item as RecordResult;
    return (
      <>
        {record.body && <MarkdownContent text={record.body} />} {main && <ChangeContext record={record} compact />}
        <TagNames compact scope="record" ids={record.tag_ids} onReadyChange={onTagsReady} />
      </>
    );
  }
  return null;
}
