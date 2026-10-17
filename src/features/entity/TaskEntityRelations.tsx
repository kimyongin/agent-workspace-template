import { createPagedList } from "../collections/paged-list.ts";
import { CollectionList } from "../../components/Collection.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SurfaceContext } from "../../components/Modal.tsx";
import { useLocation } from "react-router";
import { useDetailViewState } from "../../lib/detail-exploration.tsx";
import type { EntityDetail } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { FormModal } from "../../components/ContentForm.tsx";
import { Notice } from "../../components/Field.tsx";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { api, query } from "../../lib/api.ts";
import { type Candidate, RelationSearch, RelationSearchAction } from "../relations/RelationSearch.tsx";

type Mutation = { task: TaskResult; entity: Candidate; remove: boolean; ids: string[] };
/** Both directions patch the task's single membership field; no mirrored entity state. */
function RelationControls({
  task,
  entityId,
  entityTitle,
  revision,
  children,
  onSaved,
}: {
  task?: TaskResult;
  entityId?: string;
  entityTitle?: string;
  revision?: EntityDetail["tasks"];
  children: (controls: { search: ReactNode; button: ReactNode; unlink: (item: Candidate) => ReactNode }) => ReactNode;
  onSaved: (saved?: TaskResult, before?: TaskResult) => void;
}) {
  const surface = useContext(SurfaceContext);
  const location = useLocation(), locationKey = useRef(location.key);
  locationKey.current = location.key;
  const [searching, setSearching] = useDetailViewState("relation-search-open", false);
  const searchId = useId();
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string | null>(null),
    [mutation, setMutation] = useState<Mutation | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const prepare = async (item: Candidate, remove: boolean) => {
    if (preparing) return;
    const startedKey = locationKey.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPreparing(true);
    setError(null);
    try {
      const latest = await api<TaskResult>("GET", `/tasks/${task?.id ?? item.id}`, undefined, controller.signal);
      if (controller.signal.aborted || locationKey.current !== startedKey || surface?.editor.current) return;
      const entity = task ? item : { id: entityId!, title: entityTitle! }, ids = latest.entity_ids;
      if (ids.includes(entity.id) === !remove) {
        onSaved(latest);
        return;
      }
      setMutation({
        task: latest,
        entity,
        remove,
        ids: remove ? ids.filter((id) => id !== entity.id) : [...ids, entity.id],
      });
    } catch {
      if (!controller.signal.aborted) setError("최신 연결을 불러오지 못했습니다. 다시 시도하세요.");
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  };
  const kind = task ? "entity" : "task";
  const unlink = (item: Candidate) => (
    <BodyAction
      icon="unlink"
      aria-label={`${item.title} 해제`}
      aria-disabled={preparing}
      onClick={() => void prepare(item, true)}
    >
      해제
    </BodyAction>
  );
  return (
    <>
      {children({
        button: (
          <RelationSearchAction
            kind={kind}
            expanded={searching}
            controls={searchId}
            disabled={preparing}
            onToggle={() => setSearching((value) => !value)}
          />
        ),
        unlink,
        search: (
          <>
            {error && <Notice kind="error">{error}</Notice>}
            {preparing && <p className="secondary" role="status">연결 확인 중…</p>}
            <div id={searchId} hidden={!searching}>
              {searching && (
                <RelationSearch
                  kind={kind}
                  revision={task?.version ?? revision}
                  disabled={preparing}
                  excluded={(item) => task ? task.entity_ids.includes(item.id) : !!item.entityIds?.includes(entityId!)}
                  onChoose={(item) => void prepare(item, false)}
                />
              )}
            </div>
          </>
        ),
      })}
      {mutation && (
        <FormModal
          open
          confirmationOnly
          title={mutation.remove ? "해제" : "연결"}
          submitLabel="저장"
          dirty={false}
          preparation={() => ({
            model: "task",
            action: "update",
            target_id: mutation.task.id,
            expected_version: mutation.task.version,
            input: { entity_ids: mutation.ids },
          })}
          mutation={{
            target: `${mutation.task.title} — ${mutation.entity.title}`,
            action: mutation.remove ? "해제" : "연결",
            message: mutation.remove ? "연결만 해제하며 원문과 과거 기록은 유지합니다." : undefined,
          }}
          onClose={() => {
            setMutation(null);
            onSaved();
          }}
          onRouteDiscard={() => setMutation(null)}
          validate={() => null}
          onSubmit={async (requestKey, memo) => {
            const saved = await api<TaskResult>(
              "PATCH",
              `/tasks/${mutation.task.id}`,
              { expected_version: mutation.task.version, entity_ids: mutation.ids, ...memo },
              undefined,
              requestKey(),
            );
            setMutation(null);
            onSaved(saved, mutation.task);
          }}
        >
          {() => null}
        </FormModal>
      )}
    </>
  );
}

export function TaskEntityRelations(
  { task, onSaved, readOnly = false }: { task: TaskResult; readOnly?: boolean; onSaved: (saved?: TaskResult, before?: TaskResult) => void },
) {
  if (readOnly) return <RelatedSection views={false} title="연결된 자료" count={task.entity_ids.length}>
    <CollectionList columns={["자료 이름"]}>{task.entity_ids.map(id => <li key={id}><RelatedItem title={task.entity_context.find(item => item.id === id)?.title ?? "자료"}/></li>)}</CollectionList>
  </RelatedSection>;
  return (
    <RelationControls key={task.id} task={task} onSaved={onSaved}>
      {({ search, button, unlink }) => (
        <RelatedSection title="연결된 자료" count={task.entity_ids.length} action={button}>
          {search}
          <CollectionList columns={["자료 이름"]}>
            {task.entity_ids.map((id) => {
              const item = {
                id,
                title: task.entity_context.find((item) => item.id === id)?.title ?? "자료",
              };
              return (
                <li key={id}>
                  <RelatedPreviewItem
                    to={`/entities/${encodeURIComponent(id)}`}
                    title={item.title}
                    action={unlink(item)}
                  />
                </li>
              );
            })}
          </CollectionList>
        </RelatedSection>
      )}
    </RelationControls>
  );
}

export function EntityTaskRelations(
  { entity, onCreate, onSaved }: {
    entity: EntityDetail;
    onCreate: () => void;
    onSaved: (saved?: TaskResult, before?: TaskResult) => void;
  },
) {
  // The detail's five-row preview is not a cursor page: fetch page one only on expansion.
  const session = useMemo(() =>
    createPagedList<TaskResult, { items: TaskResult[]; next_cursor: string | null }>({
      load: (cursor, signal) =>
        api("GET", `/tasks${query({ entity_id: entity.id, limit: 20, cursor })}`, undefined, signal),
    }), [entity.id, entity.tasks]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => () => session.cancel(), [session]);
  const previewIds = new Set(entity.tasks.items.map((item) => item.id));
  const items = [...entity.tasks.items, ...state.page?.items.filter((item) => !previewIds.has(item.id)) ?? []];
  const loading = state.busy, failed = !!state.error;
  const more = () => {
    if (failed) void session.retry();
    else if (!state.page) void session.restore(1);
    else session.more();
  };
  return (
    <RelationControls
      key={entity.id}
      entityId={entity.id}
      entityTitle={entity.title}
      revision={entity.tasks}
      onSaved={onSaved}
    >
      {({ search, button, unlink }) => (
        <RelatedSection
          title="할 일"
          count={entity.tasks.count}
          action={
            <div className="actions">
              <BodyAction icon="create" aria-label="할 일 작성" onClick={onCreate}>작성</BodyAction>
              {button}
            </div>
          }
        >
          {search}
          <CollectionList columns={["제목"]}>
            {items.map((item) => (
              <li key={item.id}>
                <RelatedPreviewItem to={`/tasks/${item.id}`} title={item.title} action={unlink(item)} />
              </li>
            ))}
          </CollectionList>
          {failed && <Notice kind="error">연결된 할 일을 불러오지 못했습니다.</Notice>}
          {(failed || state.page?.next_cursor || !state.page && entity.tasks.count > items.length) && (
            <BodyAction
              disabled={loading}
              onClick={() => void more()}
            >
              {loading ? "불러오는 중…" : failed ? "할 일 다시 시도" : "할 일 더 보기"}
            </BodyAction>
          )}
        </RelatedSection>
      )}
    </RelationControls>
  );
}
