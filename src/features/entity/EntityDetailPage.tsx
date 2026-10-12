import { detailModeLink } from "../../lib/entity-list-url.ts";
import { EntityPairRelations } from "./EntityPairRelations.tsx";
import { entityPath } from "@contracts/entity-identity.ts";
import { useDetailResource } from "../details/useDetailResource.ts";
import { CollectionList } from "../../components/Collection.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import type { EntityContext } from "@contracts/entity-links.ts";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedRecordItem } from "../activity/RelatedRecords.tsx";
import { useDetailDeleteReturn, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { useEntityIdentityChange } from "../details/useEntityIdentityChange.ts";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { TagNames } from "../tags/TagPicker.tsx";
import { EntityProperties } from "./EntityProperties.tsx";
import { EntityTypeIcon } from "./EntityTypeIcon.tsx";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { DetailSurface, DetailTitle } from "../../components/Modal.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal } from "../activity/forms.tsx";
import "./entity.css";
import { EntityTaskRelations } from "./TaskEntityRelations.tsx";
export function EntityDetailPage() {
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams(),
    [params] = useSearchParams(),
    navigate = useDetailNavigate();
  const afterClose = useDeferredNavigation();
  const relationSaved = useRef(false);
  const location = useLocation();
  const [creating, setCreating] = useState<"task" | "record" | null>(null);
  const returnCreateFocus = useRef<"task" | "record" | null>(null),
    previousCreate = useRef<"task" | "record" | null>(null);
  const closeCreate = () => {
    returnCreateFocus.current = creating;
    setCreating(null);
    const p = new URLSearchParams(params);
    p.delete("create");
    afterClose(detailModeLink(location.pathname, p, location.hash), true);
  };
  useEffect(() => {
    const value = params.get("create"), next = value === "task" || value === "record" ? value : null;
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
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => {
    if (detail.loading) setError(null);
  }, [detail.loading]);
  const error = actionError ??
    (detail.error ? detail.error instanceof ApiError ? detail.error.message : "자료를 불러오지 못했습니다." : null);
  const reload = detail.reload;
  const editor = useDetailEditor(detail.editClosed);
  const replaceIdentityVisit = useEntityIdentityChange(editor.formProps.onRouteDiscard);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!detail.confirmed && entity) relationSaved.current = false;
  }, [entity, detail.confirmed]);
  const returnParams = new URLSearchParams(params);
  ["edit", "edit_from", "create"].forEach((key) => returnParams.delete(key));
  const back = useDetailOwnerReturn(`/entities?${returnParams}${id ? `#${encodeURIComponent(`entity-${id}`)}` : ""}`);
  const deleteBack = useDetailDeleteReturn(back);
  useEffect(() => {
    if (creating || !editReady || !returnCreateFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const label = returnCreateFocus.current === "task" ? "할 일 작성" : "기록 작성";
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] .detail-management button"))
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
    <div className="detail-management">
      {error && (
        <>
          <Notice kind="error">
            {relationSaved.current ? "연결은 저장했습니다. 최신 내용을 불러오지 못했습니다." : error}
          </Notice>
          <button type="button" className="btn" onClick={() => void reload()}>
            다시 시도
          </button>
        </>
      )}
      <EntityTaskRelations
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
          action={
            <BodyAction
              icon="create"
              aria-label="기록 작성"
              onClick={() => {
                const p = new URLSearchParams(params);
                p.set("create", "record");
                navigate(detailModeLink(location.pathname, p, location.hash));
              }}
            >
              작성
            </BodyAction>
          }
        >
          {entity[kind].count > 0 && (
            <CollectionList>
              {entity[kind].items.map((item) => (
                <li key={item.id}>
                  <RelatedRecordItem record={item} />
                </li>
              ))}
            </CollectionList>
          )}
        </RelatedSection>
      ))}
    </div>
  );
  return (
    <DetailSurface
      title={entity?.type.label ?? "자료"}
      tabTitle={entity?.title ?? "자료"}
      onClose={() => navigate(back)}
      onError={detail.failed}
      busy={busy}
      footer={entity && (
        <button type="button" className="btn btn-primary" onClick={editor.start}>
          {entity.deleted_at ? "복원" : "편집"}
        </button>
      )}
    >
      {error && !entity && (
        <>
          <Notice kind="error">{error}</Notice>
          <button className="btn" onClick={() => void reload()}>다시 시도</button>
        </>
      )}
      {!entity && !error && <p className="secondary" role="status">불러오는 중…</p>}
      {entity && (
        <div className="detail-stack">
          <section className="detail-section entity-detail-properties">
            <dl className="props">
              <div>
                <dt>발급처</dt>
                <dd>{entity.source_label} ({entity.source})</dd>
              </div>
              <div>
                <dt>식별자</dt>
                <dd className="entity-identity-value">{entity.external_id}</dd>
              </div>
              <div>
                <dt>자료 종류</dt>
                <dd>
                  <EntityTypeIcon id={entity.type.icon_id} /> {entity.type.label}
                </dd>
              </div>
              <div>
                <dt>이름</dt>
                <dd>
                  <DetailTitle>{entity.title}</DetailTitle>
                </dd>
              </div>
            </dl>
            <EntityProperties entity={entity} />
            <TagNames scope="entity" compact ids={entity.tag_ids} />
          </section>
          <div className="detail-relations">
            <EntityPairRelations
              entity={entity}
              onSaved={(version) => {
                detail.confirm((current) => current ? { ...current, version } : current);
                if (!editor.active) void reload();
              }}
            />
            {entity.deleted_at && (
              <>
                <RelatedSection title="할 일" count={entity.tasks.count}>
                  <CollectionList>
                    {entity.tasks.items.map((item) => (
                      <li key={item.id}>
                        <a href={`/tasks/${item.id}`}>{item.title}</a>
                      </li>
                    ))}
                  </CollectionList>
                </RelatedSection>
                <RelatedSection title="기록" count={entity.records.count}>
                  <CollectionList>
                    {entity.records.items.map((item) => (
                      <li key={item.id}>
                        <RelatedRecordItem record={item} />
                      </li>
                    ))}
                  </CollectionList>
                </RelatedSection>
              </>
            )}
            {entity.deleted_at && <p className="secondary">삭제됨</p>}
            {management}
          </div>
          {creating === "task" && !entity.deleted_at && (
            <TaskFormModal
              key={location.key}
              open
              mode="create"
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
          {creating === "record" && !entity.deleted_at && (
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
          {editor.active && !creating && editReady && (
            <EntityForm
              initial={entity}
              deletion={entity.deleted_at ? undefined : {
                preparation: () => ({
                  model: "entity",
                  action: "delete",
                  target_id: entity.id,
                  expected_version: entity.version,
                  input: {},
                }),
                message: `${entity.title}을 삭제 상태로 보관합니다. 속성·태그·할 일/기록 연결과 원문은 보존합니다.`,
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
                { source, external_id, expected_version, entity_type_id, settings_version, ...value },
                requestKey,
              ) => {
                let savedId = entity.id;
                await detail.save(async (current) => {
                  const savedEntity = await api<EntityDetail>(
                    entity.deleted_at ? "POST" : "PATCH",
                    entity.deleted_at ? "/entities" : entityPath(id),
                    {
                      ...value,
                      source,
                      external_id,
                      ...(entity.deleted_at ? { entity_type_id, settings_version } : {}),
                      expected_version: expected_version ?? entity.version,
                    },
                    undefined,
                    requestKey(),
                  );
                  savedId = savedEntity.id;
                  return { ...current, ...savedEntity };
                });
                if (savedId !== entity.id) {
                  replaceIdentityVisit(entity.id, savedId);
                } else {
                  editor.close();
                  void reload();
                }
              }}
            />
          )}
        </div>
      )}
    </DetailSurface>
  );
}
