import { DataFields } from "@/components/DataFields";
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
export function PreviewContents(
  { kind, item, main, onTagsReady, onPropertiesReady, shownTitle }: {
    kind: PreviewKind;
    item: Preview;
    main: boolean;
    onTagsReady: (ready: boolean) => void;
    onPropertiesReady: (ready: boolean) => void;
    shownTitle?: string;
  },
) {
  const tags = (scope: "entity" | "task" | "record", ids: string[]) => (
    <DataFields className="col-span-full">
      <div>
        <dt>태그</dt>
        <dd>
          <TagNames compact scope={scope} ids={ids} onReadyChange={onTagsReady} />
          {!ids.length && "없음"}
        </dd>
      </div>
    </DataFields>
  );
  if (kind === "entities") {
    const entity = item as EntityDetail;
    return (
      <>
        <EntityProperties
          entity={entity}
          activeOnly
          onReadyChange={onPropertiesReady}
        />
        <DataFields>
          {!main && entity.title !== shownTitle && <div className="col-span-full"><dt>현재 제목</dt><dd>{entity.title}</dd></div>}
          <div>
            <dt>자료 종류</dt>
            <dd>{entity.type.label}</dd>
          </div>
          {entity.deleted_at && (
            <div>
              <dt>상태</dt>
              <dd>삭제됨</dd>
            </div>
          )}
        </DataFields>
        {tags("entity", entity.tag_ids)}
      </>
    );
  }
  if (kind === "tasks") {
    const task = item as TaskResult;
    return (
      <>
        <DataFields>
          {!main && task.title !== shownTitle && (
            <div className="col-span-full">
              <dt>현재 제목</dt>
              <dd>{task.title}</dd>
            </div>
          )}
          {task.body && (
            <div className="col-span-full">
              <dt>본문</dt>
              <dd>
                <MarkdownContent text={task.body} />
              </dd>
            </div>
          )}
          {!main && (
            <>
              <div>
                <dt>상태</dt>
                <dd>
                  <StatusBadge status={task.status} />
                </dd>
              </div>
              <div>
                <dt>종류</dt>
                <dd>{taskLabels[task.kind]}</dd>
              </div>
              <div>
                <dt>{taskLabels.due_on}</dt>
                <dd>{task.due_on ?? "미입력"}</dd>
              </div>
            </>
          )}
        </DataFields>
        {tags("task", task.tag_ids)}
      </>
    );
  }
  if (kind === "records") {
    const record = item as RecordResult;
    return (
      <>
        {record.body && (
          <DataFields>
            <div>
              <dt>본문</dt>
              <dd>
                <MarkdownContent text={record.body} />
              </dd>
            </div>
          </DataFields>
        )}
        {main && <ChangeContext record={record} compact />}
        {tags("record", record.tag_ids)}
      </>
    );
  }
  return null;
}
