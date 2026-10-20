import { DataFields } from "@/components/DataFields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollectionItem, CollectionList, CollectionMessage } from "../../components/Collection.tsx";
import type { RecordResult } from "@contracts/record.ts";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import type { Preview } from "../relations/PreviewContents.tsx";
import { ApiError } from "../../lib/api.ts";
import { EntityLinkItem } from "../entity/EntityPicker.tsx";
import { RelatedTaskItem } from "./RelatedTask.tsx";
import { StatusBadge } from "./shared.tsx";

type Change = NonNullable<RecordResult["change"]>;
/** Only the immutable stored parent is navigable; historical targets are event display data. */
export function RecordRelations({ record, readOnly = false }: { record: RecordResult; readOnly?: boolean }) {
  const kind = record.task_id ? "task" : "entity";
  const id = record.task_id ?? record.entity_id;
  if (!id) return null;
  const change = record.change?.target_kind === kind && record.change.target_id === id ? record.change : null;
  const route = kind === "task" ? "tasks" : "entities";
  return <RelatedSection views={!readOnly} title={kind === "task" ? "할 일" : "자료"} count={1}>
    <CollectionList columns={[kind === "task" ? "제목" : "자료 이름"]}>
      <CollectionItem>
        {change
          ? <ChangedRelation readOnly={readOnly} change={change} path={`/${route}/${encodeURIComponent(id)}`} occurrence={record.occurrence_on} />
          : kind === "task"
          ? readOnly ? <ReadonlyTask id={id} occurrence={record.occurrence_on} /> : <RelatedTaskItem id={id} occurrence={record.occurrence_on} />
          : readOnly ? <RelatedItem title="자료" /> : <EntityLinkItem id={id} context={[]} />}
      </CollectionItem>
    </CollectionList>
  </RelatedSection>;
}

function ChangedRelation(
  { change, path, occurrence, readOnly = false }: {
    change: Change;
    path: string;
    occurrence: string | null;
    readOnly?: boolean;
  },
) {
  const read = useRelatedRead<Preview>(path, { probe: true });
  const probe = read.probe;
  const missingError = probe.error instanceof ApiError &&
    probe.error.status === 404 && probe.error.code === "not_found";
  const value = probe.value;
  const retainedTask = change.target_kind === "task" && !!value && "deleted_at" in value && !!value.deleted_at;
  const state = probe.loading
    ? "loading"
    : probe.error
    ? missingError ? "missing" : "failed"
    : value
    ? !retainedTask && "deleted_at" in value && value.deleted_at ? "missing" : "exists"
    : "loading";
  const missing = state === "missing";
  const deleted = retainedTask || missing && change.action === "delete";
  const fallback = missing
    ? (
      <p className="text-sm text-muted-foreground">
        {deleted
          ? "삭제된 항목입니다. 기록에 저장된 당시 제목을 표시합니다."
          : "현재 항목을 조회할 수 없습니다. 기록에 저장된 당시 제목을 표시합니다."}
      </p>
    )
    : state === "failed"
    ? (
      <>
        <p className="text-sm text-muted-foreground">현재 항목을 불러오지 못했습니다.</p>
        {!readOnly && (
          <Button
            variant="outline"
            type="button"
            onClick={() => void read.resource.read("probe")}
          >
            다시 시도
          </Button>
        )}
      </>
    )
    : state === "loading"
    ? <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>
    : undefined;
  const occurrenceData = occurrence
    ? (
      <DataFields>
        <div>
          <dt>회차</dt>
          <dd>{occurrence}</dd>
        </div>
      </DataFields>
    )
    : undefined;
  if (readOnly) {
    return (
      <RelatedItem
        titleLabel="당시 제목"
        title={change.target_title}
        metadata={
          <>
            {occurrenceData}
            {(missing || retainedTask) && (
              <DataFields>
                <div>
                  <dt>조회 상태</dt>
                  <dd>{deleted ? "삭제됨" : "조회 불가"}</dd>
                </div>
              </DataFields>
            )}
            {fallback}
          </>
        }
      />
    );
  }
  return (
    <RelatedPreviewItem
      titleLabel="당시 제목"
      resource={read.resource}
      to={path}
      restoreKey="change-target"
      title={change.target_title}
      titleBadge={deleted || missing ? <Badge variant="secondary">{deleted ? "삭제됨" : "조회 불가"}</Badge> : undefined}
      metadata={occurrenceData}
      fallback={fallback}
    />
  );
}

function ReadonlyTask(
  { id, occurrence }: { id: string; occurrence: string | null },
) {
  const read = useRelatedRead<TaskResult>(`/tasks/${id}`, { probe: true });
  const task = read.probe.value, cause = read.probe.error;
  if (task) {
    return (
      <RelatedItem
        title={task.title}
        metadata={
          <DataFields>
            <div>
              <dt>상태</dt>
              <dd>
                {task.deleted_at ? <Badge variant="secondary">삭제됨</Badge> : <StatusBadge status={task.status} />}
              </dd>
            </div>
            {occurrence && (
              <div>
                <dt>회차</dt>
                <dd>{occurrence}</dd>
              </div>
            )}
          </DataFields>
        }
      />
    );
  }
  return (
    <CollectionMessage className="text-sm text-muted-foreground" role={cause ? undefined : "status"}>
      {cause
        ? cause instanceof ApiError && cause.status === 404
          ? "삭제된 할 일 또는 접근할 수 없는 할 일입니다."
          : "연결된 할 일을 불러오지 못했습니다."
        : "불러오는 중…"}
    </CollectionMessage>
  );
}
