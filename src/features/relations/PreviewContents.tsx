import type { EntityDetail } from "@contracts/entity.ts";
import { EntityProperties } from "../entity/EntityProperties.tsx";
import { taskLabels, type TaskResult } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { TagNames } from "../tags/TagPicker.tsx";
import { useLayoutEffect } from "react";
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
  { kind, item, main, onTagsReady, onPropertiesReady, onRepresentativeLabel, shownTitle }: {
    kind: PreviewKind;
    item: Preview;
    main: boolean;
    onTagsReady: (ready: boolean) => void;
    onPropertiesReady: (ready: boolean) => void;
    onRepresentativeLabel?: (label: string) => void;
    shownTitle?: string;
  },
) {
  useLayoutEffect(() => {
    if (main && kind === "entities") onPropertiesReady(true);
  }, [kind, main, onPropertiesReady]);
  const tags = (scope: "entity" | "task" | "record", ids: string[]) => (
    <dl className="min-w-0 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere col-span-full">
      <div>
        <dt>태그</dt>
        <dd>
          <TagNames compact scope={scope} ids={ids} onReadyChange={onTagsReady} />
          {!ids.length && "없음"}
        </dd>
      </div>
    </dl>
  );
  if (kind === "entities") {
    const entity = item as EntityDetail;
    return (
      <>
        {!main && (
          <EntityProperties
            entity={entity}
            selection="list"
            omitRepresentative={entity.title === shownTitle}
            onReadyChange={onPropertiesReady}
            onRepresentativeLabel={onRepresentativeLabel}
          />
        )}
        <dl className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
          <div>
            <dt>자료 종류</dt>
            <dd>{entity.type.label}</dd>
          </div>
          <div>
            <dt>번호 출처</dt>
            <dd>{entity.source_label}</dd>
          </div>
          <div>
            <dt>자료 번호</dt>
            <dd>{entity.external_id}</dd>
          </div>
          {entity.deleted_at && (
            <div>
              <dt>상태</dt>
              <dd>삭제됨</dd>
            </div>
          )}
        </dl>
        {tags("entity", entity.tag_ids)}
      </>
    );
  }
  if (kind === "tasks") {
    const task = item as TaskResult;
    return (
      <>
        <dl className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
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
        </dl>
        {tags("task", task.tag_ids)}
      </>
    );
  }
  if (kind === "records") {
    const record = item as RecordResult;
    return (
      <>
        {record.body && (
          <dl className="min-w-0 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere">
            <div>
              <dt>본문</dt>
              <dd>
                <MarkdownContent text={record.body} />
              </dd>
            </div>
          </dl>
        )}
        {main && <ChangeContext record={record} compact />}
        {tags("record", record.tag_ids)}
      </>
    );
  }
  return null;
}
