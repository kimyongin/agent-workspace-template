import { CollectionList } from "../../components/Collection.tsx";
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
const groups = [
  { kind: "task", title: "할 일", route: "tasks" },
  { kind: "entity", title: "연결된 자료", route: "entities" },
  { kind: "record", title: "기록", route: "records" },
] as const;

/** Event targets and explicit relationships share one section and one card per kind/ID. */
export function RecordRelations(
  { record, readOnly = false }: { record: RecordResult; readOnly?: boolean },
) {
  return (
    <>
      {groups.map((group) => {
        const change = record.change?.target_kind === group.kind
          ? record.change
          : null;
        const selected = group.kind === "entity"
          ? record.entity_ids
          : group.kind === "task" && record.task_id
          ? [record.task_id]
          : [];
        const ids = [
          ...new Set([...(change ? [change.target_id] : []), ...selected]),
        ];
        if (!ids.length) return null;
        return (
          <RelatedSection
            views={!readOnly}
            key={group.kind}
            title={group.title}
            count={ids.length}
          >
            <CollectionList
              columns={[
                group.kind === "record"
                  ? "본문 대표 문구"
                  : group.kind === "task"
                  ? "제목"
                  : "자료 이름",
              ]}
            >
              {ids.map((id) => {
                const capture = record.entity_context.find((item) =>
                  item.id === id
                );
                return (
                  <li key={id}>
                    {change?.target_id === id
                      ? (
                        <ChangedRelation
                          readOnly={readOnly}
                          change={change}
                          path={`/${group.route}/${encodeURIComponent(id)}`}
                          occurrence={group.kind === "task" &&
                              record.task_id === id
                            ? record.occurrence_on
                            : null}
                        />
                      )
                      : group.kind === "entity"
                      ? readOnly
                        ? (
                          <RelatedItem
                            title={capture?.title ?? "연결된 자료"}
                            metadata={
                              <dl className="key-value-static">
                                {capture?.type && (
                                  <>
                                    <div>
                                      <dt>자료 종류</dt>
                                      <dd>{capture.type.label}</dd>
                                    </div>
                                    <div>
                                      <dt>속성 버전</dt>
                                      <dd>{capture.schema_version ?? "—"}</dd>
                                    </div>
                                  </>
                                )}
                                <div>
                                  <dt>자료 ID</dt>
                                  <dd>{id}</dd>
                                </div>
                              </dl>
                            }
                          />
                        )
                        : (
                          <EntityLinkItem
                            id={id}
                            context={record.entity_context}
                          />
                        )
                      : group.kind === "task"
                      ? readOnly
                        ? (
                          <ReadonlyTask
                            id={id}
                            occurrence={record.occurrence_on}
                          />
                        )
                        : (
                          <RelatedTaskItem
                            id={id}
                            occurrence={record.occurrence_on}
                          />
                        )
                      : null}
                  </li>
                );
              })}
            </CollectionList>
          </RelatedSection>
        );
      })}
    </>
  );
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
  const state = probe.loading
    ? "loading"
    : probe.error
    ? missingError ? "missing" : "failed"
    : value
    ? "deleted_at" in value && value.deleted_at ? "missing" : "exists"
    : "loading";
  const missing = state === "missing";
  const deleted = missing && change.action === "delete";
  const fallback = missing
    ? (
      <p className="secondary">
        {deleted
          ? "삭제된 항목입니다. 기록에 저장된 당시 제목을 표시합니다."
          : "현재 항목을 조회할 수 없습니다. 기록에 저장된 당시 제목을 표시합니다."}
      </p>
    )
    : state === "failed"
    ? (
      <>
        <p className="secondary">현재 항목을 불러오지 못했습니다.</p>
        {!readOnly && (
          <button
            type="button"
            className="btn"
            onClick={() => void read.resource.read("probe")}
          >
            다시 시도
          </button>
        )}
      </>
    )
    : state === "loading"
    ? <p className="secondary" role="status">불러오는 중…</p>
    : undefined;
  const occurrenceData = occurrence
    ? (
      <dl className="key-value-static">
        <div>
          <dt>회차</dt>
          <dd>{occurrence}</dd>
        </div>
      </dl>
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
            {missing && (
              <dl className="key-value-static">
                <div>
                  <dt>조회 상태</dt>
                  <dd>{deleted ? "삭제됨" : "조회 불가"}</dd>
                </div>
              </dl>
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
      titleBadge={missing
        ? <span className="badge">{deleted ? "삭제됨" : "조회 불가"}</span>
        : undefined}
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
          <dl className="key-value-static">
            <div>
              <dt>상태</dt>
              <dd>
                <StatusBadge status={task.status} />
              </dd>
            </div>
            {occurrence && (
              <div>
                <dt>회차</dt>
                <dd>{occurrence}</dd>
              </div>
            )}
          </dl>
        }
      />
    );
  }
  return (
    <p className="secondary" role={cause ? undefined : "status"}>
      {cause
        ? cause instanceof ApiError && cause.status === 404
          ? "삭제된 할 일 또는 접근할 수 없는 할 일입니다."
          : "연결된 할 일을 불러오지 못했습니다."
        : "불러오는 중…"}
    </p>
  );
}
