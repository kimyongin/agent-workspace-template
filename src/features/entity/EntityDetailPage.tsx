import { useTaskAccess } from "../activity/task-access.ts";
import { useEntityReadAccess, useEntityWriteAccess } from "./entity-access.ts";
import { useApi } from "../../lib/api-context.tsx";
import { PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { recordDisplayText } from "@contracts/record-display.ts";
import { CreateRelatedEntityForm } from "./CreateRelatedEntityForm.tsx";
import { EntityTypedRelations } from "./EntityTypedRelations.tsx";
import { detailModeLink } from "../../lib/entity-list-url.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { useDetailResource } from "../details/useDetailResource.ts";
import { CollectionItem, CollectionList  } from "../../components/Collection.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";

import type { EntityContext } from "@contracts/entity-links.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedRecordItem } from "../activity/RelatedRecords.tsx";
import { RelatedTaskItem } from "../activity/RelatedTask.tsx";
import { useDetailDeleteReturn, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { TagConnections } from "../tags/TagConnections.tsx";
import { EntityProperties } from "./EntityProperties.tsx";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "../../lib/workspace-router.tsx";
import { Notice } from "../../components/Field.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { ApiError } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal } from "../activity/forms.tsx";
import { EntityTaskRelations, useEntityTaskRead } from "./TaskEntityRelations.tsx";
export function EntityDetailPage() {
  const taskAccess = useTaskAccess();
  const api = useApi(), canWriteType = useEntityWriteAccess(), canReadType = useEntityReadAccess();
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams(),
    [params] = useSearchParams(),
    navigate = useDetailNavigate();
  const afterClose = useDeferredNavigation();
  const relationSaved = useRef(false);
  const relationCreateTarget = useRef<string | null>(null);
  const location = useLocation();
  const [creating, setCreating] = useState<"task" | "record" | "relation" | null>(null);
  const returnCreateFocus = useRef<"task" | "record" | "relation" | null>(null),
    previousCreate = useRef<"task" | "record" | "relation" | null>(null);
  const closeCreate = () => {
    returnCreateFocus.current = creating;
    setCreating(null);
    const p = new URLSearchParams(params);
    p.delete("create");
    p.delete("relation_id");
    p.delete("relation_side");
    afterClose(detailModeLink(location.pathname, p, location.hash), true);
  };
  useEffect(() => {
    const value = params.get("create"),
      next = value === "task" || value === "record" || value === "relation" ? value : null;
    if (!next && previousCreate.current) returnCreateFocus.current = previousCreate.current;
    previousCreate.current = next;
    setCreating(next);
  }, [location.key]);
  const detail = useDetailResource<EntityDetail>({
    id,
    query: params.toString(),
    refreshOnQuery: !params.has("create"),
    readyAfterFailedRefresh: true,
    load: (id, signal) => api("GET", entityPath(id), undefined, signal),
  });
  const { value: entity, editReady } = detail;
  const canWrite = !!entity && canWriteType(entity.entity_type_id);
  const canRead = !!entity && canReadType(entity.entity_type_id);
  const taskRead = useEntityTaskRead(entity);
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => {
    if (detail.loading) setError(null);
  }, [detail.loading]);
  const error = actionError ??
    (detail.error ? detail.error instanceof ApiError ? detail.error.message : "자료를 불러오지 못했습니다." : null);
  const reload = detail.reload;
  const editor = useDetailEditor(detail.editClosed);
  const admittedEdit = useRef<{ api: typeof api; id: string; key: string } | null>(null);
  const editing = editor.active && !creating && editReady && (canWrite ||
    admittedEdit.current?.api === api && admittedEdit.current.id === id && admittedEdit.current.key === location.key);
  useLayoutEffect(() => {
    if (!editor.active || admittedEdit.current?.api !== api || admittedEdit.current.id !== id ||
      admittedEdit.current.key !== location.key) admittedEdit.current = null;
    if (editor.active && !creating && editReady && canWrite) admittedEdit.current = { api, id, key: location.key };
  }, [api, id, location.key, editor.active, creating, editReady, canWrite]);
  const [busy, setBusy] = useState(false);
  const readRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!detail.confirmed && entity) relationSaved.current = false;
  }, [entity, detail.confirmed]);
  const returnParams = new URLSearchParams(params);
  ["edit", "edit_from", "create", "relation_id", "relation_side"].forEach((key) => returnParams.delete(key));
  const back = useDetailOwnerReturn(`/entities?${returnParams}${id ? `#${encodeURIComponent(`entity-${id}`)}` : ""}`);
  const deleteBack = useDetailDeleteReturn(back);
  useEffect(() => {
    if (creating || !editReady || !returnCreateFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (returnCreateFocus.current === "relation") {
        const button = Array.from(
          readRoot.current?.querySelectorAll<HTMLButtonElement>('[aria-label$="작성해서 연결"]') ?? [],
        ).find((el) => el.dataset.relationCreate === relationCreateTarget.current);
        button?.focus();
        returnCreateFocus.current = null;
        return;
      }
      const label = returnCreateFocus.current === "task" ? "할 일 작성" : "기록 작성";
      const button = Array.from(readRoot.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])
        .find((el) => el.getAttribute("aria-label") === label);
      if (button) {
        button.focus();
        returnCreateFocus.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [creating, editReady, entity]);
  const entityContext: EntityContext[] = entity
    ? [{ id: entity.id, title: entity.title, source: "selection", captured_at: new Date().toISOString() }]
    : [];
  const management = entity && !entity.deleted_at && (
    <div className="flex min-w-0 flex-col gap-6">
      {error && (
        <>
          <Notice kind="error">
            {relationSaved.current ? "연결은 저장했습니다. 최신 내용을 불러오지 못했습니다." : error}
          </Notice>
          <Button variant="outline" type="button"  onClick={() => void reload()}>
            다시 시도
          </Button>
        </>
      )}
      <EntityTaskRelations
        read={taskRead}
        entity={entity}
        onSaved={(saved, before) => {
          if (saved && before) {
            relationSaved.current = true;
            detail.confirm((current) => {
              if (!current) return current;
              const linked = saved.entity_ids.includes(current.id), wasLinked = before.entity_ids.includes(current.id);
              const items = current.tasks.items.filter((item) => item.id !== saved.id);
              if (linked) items.push({ id: saved.id, title: saved.title, updated_at: saved.updated_at });
              items.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
              return {
                ...current,
                tasks: {
                  count: Math.max(0, current.tasks.count + Number(linked) - Number(wasLinked)),
                  items: items.slice(0, 5),
                },
              };
            });
          }
          void reload();
        }}
        onCreate={() => {
          if (!taskAccess.canWrite || !canRead) return;
          const p = new URLSearchParams(params);
          p.set("create", "task");
          navigate(detailModeLink(location.pathname, p, location.hash));
        }}
      />
      {([["records", "기록"]] as const).map(([kind, label]) => (
        <RelatedSection
          key={kind}
          title={label}
          count={entity[kind].count}
          action={canWrite && (
            <Button variant="ghost" type="button"

              aria-label="기록 작성"
              onClick={() => {
                const p = new URLSearchParams(params);
                p.set("create", "record");
                navigate(detailModeLink(location.pathname, p, location.hash));
              }}
            ><PlusIcon data-icon="inline-start" />
              작성
            </Button>
          )}
        >
          {entity[kind].count > 0 && (
            <CollectionList columns={["본문 대표 문구"]}>
              {entity[kind].items.map((item) => (
                <CollectionItem key={item.id}>
                  <RelatedRecordItem record={item} />
                </CollectionItem>
              ))}
            </CollectionList>
          )}
        </RelatedSection>
      ))}
    </div>
  );
  return (
    <DetailSurface visible={!entity || canRead} ready={!detail.loading}
      title={entity && canRead ? entity.type.label : "자료"}
      description="속성과 연결된 자료·할 일·기록을 확인하고 수정합니다."
      tabTitle={entity && canRead ? entity.title : "자료"}
      onClose={() => navigate(back)}
      onError={detail.failed}
      busy={busy}
      footer={entity && canWrite && (
        <Button variant="default" type="button"  onClick={editor.start}>
          {entity.deleted_at ? "복원" : "편집"}
        </Button>
      )}
    >
      {error && !entity && (
        <>
          <Notice kind="error">{error}</Notice>
          <Button variant="outline"  onClick={() => void reload()}>다시 시도</Button>
        </>
      )}
      {!entity && !error && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
      {entity && (
        <div ref={readRoot} className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-4 min-w-0">
            <EntityProperties
              entity={entity}
              identity={
                <>
                  <div>
                    <dt>번호 출처</dt>
                    <dd>{entity.source_label}</dd>
                  </div>
                  <div>
                    <dt>자료 번호</dt>
                    <dd className="wrap-anywhere tabular-nums">{entity.external_id}</dd>
                  </div>
                </>
              }
            />
            <TagConnections
              onDraftClosed={detail.editClosed}
              scope="entity"
              target={entity}
              readonly={!canWrite || !!entity.deleted_at}
              visible={canRead}
              onSaved={(saved) => {
                relationSaved.current = true;
                detail.confirm((current) => current ? { ...current, ...saved } : current);
                void reload();
              }}
            />
          </section>
          <div className="flex min-w-0 flex-col gap-6 border-t pt-6">
            <EntityTypedRelations
              entity={entity}
              onCreate={(definition, side) => {
                relationCreateTarget.current = `${definition.id}:${side}`;
                const p = new URLSearchParams(params);
                p.set("create", "relation");
                p.set("relation_id", definition.id);
                p.set("relation_side", String(side));
                navigate(detailModeLink(location.pathname, p, location.hash));
              }}
              onSaved={(version) => {
                detail.confirm((current) => current ? { ...current, version } : current);
                if (!editor.active) void reload();
              }}
            />
            {entity.deleted_at && (
              <>
                <RelatedSection title="할 일" count={entity.tasks.count}>
                  <CollectionList columns={["제목"]}>
                    {entity.tasks.items.map((item) => (
                      <CollectionItem key={item.id}>
                        <RelatedTaskItem id={item.id} occurrence={null} />
                      </CollectionItem>
                    ))}
                  </CollectionList>
                </RelatedSection>
                <RelatedSection title="기록" count={entity.records.count}>
                  <CollectionList columns={["본문 대표 문구"]}>
                    {entity.records.items.map((item) => (
                      <CollectionItem key={item.id}>
                        <RelatedRecordItem record={item} />
                      </CollectionItem>
                    ))}
                  </CollectionList>
                </RelatedSection>
              </>
            )}
            {entity.deleted_at && <p className="text-sm text-muted-foreground">삭제됨</p>}
            {management}
          </div>
          {creating === "relation" && !entity.deleted_at && (
            <CreateRelatedEntityForm
              key={location.key}
              originId={entity.id}
              definitionId={params.get("relation_id") ?? ""}
              side={params.get("relation_side") === "1" ? 1 : 0}
              onClose={closeCreate}
              onRouteDiscard={() => setCreating(null)}
              onSaved={(result) => {
                detail.confirm((current) =>
                  current
                    ? {
                      ...current,
                      version: result.relation.endpoint_versions.find((e) => e.id === entity.id)!.version,
                    }
                    : current
                );
                closeCreate();
                void reload();
              }}
            />
          )}
          {creating === "task" && !entity.deleted_at && (
            <TaskFormModal
              key={location.key}
              open
              mode="create"
              visible={canRead}
              initial={{ ...emptyTask(timezone), entity_ids: [entity.id], entity_context: entityContext }}
              onClose={closeCreate}
              onRouteDiscard={() => setCreating(null)}
              onSave={async (save) => {
                await save();
                closeCreate();
                void reload();
              }}
            />
          )}
          {creating === "record" && canWrite && !entity.deleted_at && (
            <RecordFormModal
              key={location.key}
              open
              title="기록 작성"
              submitLabel="저장"
              initial={{ ...emptyRecord(), entity_ids: [entity.id], entity_context: entityContext }}
              onClose={closeCreate}
              onRouteDiscard={() => setCreating(null)}
              onSave={async (value, requestKey) => {
                await api("POST", "/records", { ...value }, undefined, requestKey());
                closeCreate();
                void reload();
              }}
            />
          )}
          {editing && (
            <EntityForm
              initial={entity}
              relations={
                <div className="flex min-w-0 flex-col gap-6 border-t pt-6">
                  <EntityTypedRelations entity={entity} readOnly onSaved={() => {}} />
                  <EntityTaskRelations entity={entity} read={taskRead} readOnly />
                  <RelatedSection title="기록" count={entity.records.count} views={false}>
                    <CollectionList columns={["본문 대표 문구"]}>
                      {entity.records.items.map((item) => (
                        <CollectionItem key={item.id}>
                          <RelatedItem title={recordDisplayText(item.body)} />
                        </CollectionItem>
                      ))}
                    </CollectionList>
                  </RelatedSection>
                </div>
              }
              deletion={!canWrite || entity.deleted_at ? undefined : {
                preparation: () => ({
                  model: "entity",
                  action: "delete",
                  target_id: entity.id,
                  expected_version: entity.version,
                  input: {},
                }),
                target: entity.title,
                message: "이 자료를 삭제 상태로 보관합니다. 속성·태그·할 일/기록 연결과 원문은 보존합니다.",
                onConfirm: async (reason, tags, requestKey) => {
                  setBusy(true);
                  try {
                    await api(
                      "POST",
                      `${entityPath(id)}/delete`,
                      { expected_version: entity.version, change_note: reason, change_tag_ids: tags },
                      undefined,
                      requestKey(),
                    );
                    editor.leave(deleteBack);
                  } catch (e) {
                    setError(
                      e instanceof ApiError ? e.message : "삭제하지 못했습니다.",
                    );
                    throw e;
                  } finally {
                    setBusy(false);
                  }
                },
              }}
              {...editor.formProps}
              onSave={async (
                { source, external_id, expected_version, entity_type_id, identity_version, ...value },
                requestKey,
              ) => {
                await detail.save(async (current) => {
                  const savedEntity = await api<EntityDetail>(
                    entity.deleted_at ? "POST" : "PATCH",
                    entity.deleted_at ? "/entities" : entityPath(id),
                    {
                      ...value,
                      ...(entity.deleted_at ? { source, external_id, entity_type_id, identity_version } : {}),
                      expected_version: expected_version ?? entity.version,
                    },
                    undefined,
                    requestKey(),
                  );
                  return { ...current, ...savedEntity };
                });
                editor.close();
                void reload();
              }}
            />
          )}
        </div>
      )}
    </DetailSurface>
  );
}
