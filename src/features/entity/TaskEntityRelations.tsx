import { useEntityReadAccess } from "./entity-access.ts";
import { useTaskAccess } from "../activity/task-access.ts";
import { useApi } from "../../lib/api-context.tsx";
import { Button } from "../../components/ui/button.tsx";
import { UnlinkIcon, PlusIcon } from "lucide-react";
import { createPagedList } from "../collections/paged-list.ts";
import { CollectionItem, CollectionList  } from "../../components/Collection.tsx";

import { type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SurfaceContext } from "../../components/Modal.tsx";
import { useLocation } from "../../lib/workspace-router.tsx";
import { useDetailViewState } from "../../lib/detail-exploration.tsx";
import type { EntityDetail } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { FormModal } from "../../components/ContentForm.tsx";
import { Notice } from "../../components/Field.tsx";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { query } from "../../lib/api.ts";
import { type Candidate, RelationSearch, RelationSearchAction } from "../relations/RelationSearch.tsx";

type Mutation = { task: TaskResult; entity: Candidate; remove: boolean; ids: string[] };
/** Both directions patch the task's single membership field; no mirrored entity state. */
function RelationControls({
  task,
  entityId,
  entityTitle,
  revision,
  visible = true,
  children,
  onSaved,
}: {
  task?: TaskResult;
  entityId?: string;
  entityTitle?: string;
  revision?: EntityDetail["tasks"];
  visible?: boolean;
  children: (controls: { search: ReactNode; button: ReactNode; unlink: (item: Candidate) => ReactNode }) => ReactNode;
  onSaved: (saved?: TaskResult, before?: TaskResult) => void;
}) {
  const api = useApi();
  const { canWrite } = useTaskAccess();
  const [owner] = useState(() => api);
  const canReadType = useEntityReadAccess();
  const active = owner === api && visible;
  const authority = useRef({ active, canWrite });
  authority.current = { active, canWrite };
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
    if (preparing || !active || !canWrite) return;
    const startedKey = locationKey.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPreparing(true);
    setError(null);
    try {
      const latest = await api<TaskResult>("GET", `/tasks/${task?.id ?? item.id}`, undefined, controller.signal);
      if (controller.signal.aborted || locationKey.current !== startedKey || !authority.current.active || !authority.current.canWrite || surface?.editor.current) return;
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
  const unlink = (item: Candidate) => !active || !canWrite ? null : (
    <Button variant="ghost" type="button"

      aria-label={`${item.title} 해제`}
      aria-disabled={preparing}
      onClick={() => void prepare(item, true)}
    ><UnlinkIcon data-icon="inline-start" />
      해제
    </Button>
  );
  return (
    <>
      {children({
        button: !active || !canWrite ? null : (
          <RelationSearchAction
            kind={kind}
            expanded={searching}
            controls={searchId}
            disabled={preparing}
            onToggle={() => setSearching((value) => !value)}
          />
        ),
        unlink,
        search: !active || !canWrite ? null : (
          <>
            {error && <Notice kind="error">{error}</Notice>}
            {preparing && <p className="text-sm text-muted-foreground" role="status">연결 확인 중…</p>}
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
          visible={active && (!mutation.entity.type || canReadType(mutation.entity.type.id))}
          submitDisabled={!active || !canWrite || !!mutation.entity.type && !canReadType(mutation.entity.type.id)}
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
            if (!authority.current.active || !authority.current.canWrite) throw new Error("현재 할 일 쓰기 권한이 없습니다.");
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
  const canReadType = useEntityReadAccess();
  const readable = task.entity_context.filter(item => item.type && canReadType(item.type.id));
  task = { ...task, entity_ids: task.entity_ids.filter(id => readable.some(item => item.id === id)), entity_context: readable };
  if (readOnly) return <RelatedSection views={false} title="연결된 자료" count={task.entity_ids.length}>
    <CollectionList columns={["자료 이름"]}>{task.entity_ids.map(id => <CollectionItem key={id}><RelatedItem title={task.entity_context.find(item => item.id === id)?.title ?? "자료"}/></CollectionItem>)}</CollectionList>
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
                type: task.entity_context.find((item) => item.id === id)?.type,
              };
              return (
                <CollectionItem key={id}>
                  <RelatedPreviewItem
                    to={`/entities/${encodeURIComponent(id)}`}
                    title={item.title}
                    action={unlink(item)}
                  />
                </CollectionItem>
              );
            })}
          </CollectionList>
        </RelatedSection>
      )}
    </RelationControls>
  );
}

/** The detail visit owns paging so viewing and editing share already-read links. */
export function useEntityTaskRead(entity: EntityDetail | null) {
  const api = useApi();
  const previewKey = JSON.stringify(entity?.tasks);
  // The detail's five-row preview is not a cursor page: fetch page one only on expansion.
  const session = useMemo(() =>
    createPagedList<TaskResult, { items: TaskResult[]; next_cursor: string | null }>({
      load: (cursor, signal) =>
        api("GET", `/tasks${query({ entity_id: entity?.id ?? "", limit: 20, cursor })}`, undefined, signal),
    }), [api, entity?.id, previewKey]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => () => session.cancel(), [session]);
  const preview = entity?.tasks.items ?? [];
  const previewIds = new Set(preview.map((item) => item.id));
  const items = [...preview, ...state.page?.items.filter((item) => !previewIds.has(item.id)) ?? []];
  const loading = state.busy, failed = !!state.error;
  const more = () => {
    if (failed) void session.retry();
    else if (!state.page) void session.restore(1);
    else void session.more();
  };
  return {
    items,
    loading,
    failed,
    more,
    canReadMore: failed || !!state.page?.next_cursor || !state.page && (entity?.tasks.count ?? 0) > items.length,
  };
}

export function EntityTaskRelations({ entity, read, readOnly = false, onCreate, onSaved }: {
  entity: EntityDetail;
  read: ReturnType<typeof useEntityTaskRead>;
  readOnly?: boolean;
  onCreate?: () => void;
  onSaved?: (saved?: TaskResult, before?: TaskResult) => void;
}) {
  const { canRead, canWrite } = useTaskAccess();
  const canReadType = useEntityReadAccess();
  const visible = canRead && canReadType(entity.entity_type_id);
  const contents = (search?: ReactNode, action?: ReactNode, unlink?: (item: Candidate) => ReactNode) => (
    <RelatedSection title="할 일" count={entity.tasks.count} views={!readOnly} action={action}>
      {search}
      <CollectionList columns={["제목"]}>
        {read.items.map((item) => (
          <CollectionItem key={item.id}>
            {readOnly
              ? <RelatedItem title={item.title} />
              : <RelatedPreviewItem to={`/tasks/${item.id}`} title={item.title} action={unlink?.(item)} />}
          </CollectionItem>
        ))}
      </CollectionList>
      {read.failed && <Notice kind="error">연결된 할 일을 불러오지 못했습니다.</Notice>}
      {read.canReadMore && (
        <Button variant="ghost" type="button" disabled={read.loading} onClick={read.more}>
          {read.loading ? "불러오는 중…" : read.failed ? "할 일 다시 시도" : "할 일 더 보기"}
        </Button>
      )}
    </RelatedSection>
  );
  if (readOnly) return contents();
  return (
    <RelationControls
      key={entity.id}
      visible={visible}
      entityId={entity.id}
      entityTitle={entity.title}
      revision={entity.tasks}
      onSaved={onSaved ?? (() => {})}
    >
      {({ search, button, unlink }) =>
        contents(
          search,
          <div className="flex flex-wrap items-center gap-2">
            {visible && canWrite && <Button variant="ghost" type="button" aria-label="할 일 작성" onClick={onCreate}><PlusIcon data-icon="inline-start" />작성</Button>}
            {button}
          </div>,
          unlink,
        )}
    </RelationControls>
  );
}
