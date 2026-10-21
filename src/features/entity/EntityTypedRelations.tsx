import { DataFields } from "@/components/DataFields";
import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { Button } from "../../components/ui/button.tsx";
import { UnlinkIcon, PlusIcon, XIcon, LinkIcon } from "lucide-react";
import { useCallback, useContext, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "../../lib/workspace-router.tsx";
import type { EntityDetail, EntitySummary } from "@contracts/entity.ts";
import type { EntityRelationDefinition, EntityRelationDefinitionPage } from "@contracts/entity-relation.ts";
import type { RelationMutationResult } from "@contracts/entity-relation-links.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { query } from "../../lib/api.ts";
import { DetailLink, useDetailViewState } from "../../lib/detail-exploration.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { RelatedEmpty, RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { CollectionItem, CollectionList  } from "../../components/Collection.tsx";

import { Notice } from "../../components/Field.tsx";
import { FormModal } from "../../components/ContentForm.tsx";
import { createPagedList } from "../collections/paged-list.ts";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { type Candidate, RelationSearch } from "../relations/RelationSearch.tsx";
interface LinkPage {
  definition: EntityRelationDefinition;
  side: 0 | 1;
  origin_id: string;
  items: EntitySummary[];
  next_cursor: string | null;
}
export function EntityTypedRelations(
  { entity, onSaved, onCreate, readOnly = false }: {
    readOnly?: boolean;
    entity: EntityDetail;
    onSaved: (version: number) => void;
    onCreate?: (definition: EntityRelationDefinition, side: 0 | 1) => void;
  },
) {
  const api = useApi();
  const capability = useWorkspaceCapabilities();
  const [definitions, setDefinitions] = useState<EntityRelationDefinition[]>([]),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  // Only an admitted mutation retains its section when the business catalog hides a peer.
  const [owners, setOwners] = useState<{
    api: typeof api;
    originId: string;
    sections: Record<string, { definition: EntityRelationDefinition; side: 0 | 1 }>;
  } | null>(null);
  const retainMutation = useCallback((
    definition: EntityRelationDefinition | null,
    side: 0 | 1,
    ownerApi: typeof api,
    originId: string,
    definitionId: string,
  ) => {
    if (ownerApi !== api || originId !== entity.id) return;
    setOwners(old => {
      const sections = old?.api === api && old.originId === entity.id ? old.sections : {};
      const key = `${definitionId}-${side}`;
      if (definition ? sections[key]?.definition === definition : !sections[key]) return old;
      const next = { ...sections };
      if (definition) next[key] = { definition, side };
      else delete next[key];
      return { api, originId: entity.id, sections: next };
    });
  }, [api, entity.id]);
  const readable = (definition: EntityRelationDefinition) => definition.ends.every(end =>
    capability?.grants.some(grant => grant.target_kind === "entity_type" && grant.target_id === end.type_id &&
      (grant.access === "read" || grant.access === "write"))
  );
  const sections = new Map<string, { definition: EntityRelationDefinition; side: 0 | 1 }>();
  if (owners?.api === api && owners.originId === entity.id) {
    for (const [key, owner] of Object.entries(owners.sections)) sections.set(key, owner);
  }
  for (const definition of definitions.filter(readable)) {
    definition.ends.forEach((end, side) => {
      if (end.type_id === entity.entity_type_id) sections.set(`${definition.id}-${side}`, { definition, side: side as 0 | 1 });
    });
  }
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void (async () => {
      const rows: EntityRelationDefinition[] = [];
      let cursor: string | null = null;
      do {
        const page: EntityRelationDefinitionPage = await api(
          "GET",
          `/entity-relation-definitions${
            query({ purpose: "business", type_id: entity.entity_type_id, archived: "all", limit: 100, cursor })
          }`,
          undefined,
          c.signal,
        );
        rows.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      if (!c.signal.aborted) setDefinitions(rows);
    })().catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [api, capability, entity.entity_type_id, entity.version, retry]);
  return (
    <>
      {error && (
        <Notice kind="error">
          관계 정의를 읽지 못했습니다.<Button variant="ghost" type="button" onClick={() => setRetry((n) => n + 1)}>관계 다시 조회</Button>
        </Notice>
      )}
      {[...sections.entries()].map(([key, { definition, side }]) => (
        <EntityRelationSection
          key={key}
          entity={entity}
          definition={definition}
          side={side}
          onSaved={onSaved}
          onCreate={onCreate}
          readOnly={readOnly}
          visible={readable(definition)}
          onMutationChange={retainMutation}
          ownerApi={api}
        />
      ))}
    </>
  );
}
export function EntityRelationSection(
  { entity, definition, side, onSaved, onCreate, readOnly = false, visible = true, onMutationChange, ownerApi }: {
    readOnly?: boolean;
    visible?: boolean;
    ownerApi?: ReturnType<typeof useApi>;
    onMutationChange?: (definition: EntityRelationDefinition | null, side: 0 | 1, api: ReturnType<typeof useApi>, originId: string, definitionId: string) => void;
    entity: EntityDetail;
    definition: EntityRelationDefinition;
    side: 0 | 1;
    onSaved: (version: number) => void;
    onCreate?: (definition: EntityRelationDefinition, side: 0 | 1) => void;
  },
) {
  const api = useApi();
  const capability = useWorkspaceCapabilities();
  const surface = useContext(SurfaceContext),
    searchId = useId(),
    section = useRef<HTMLDivElement>(null),
    location = useLocation(),
    locationKey = useRef(location.key);
  locationKey.current = location.key;
  const preparation = useRef<AbortController | null>(null),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useDetailViewState(`typed-relation-${definition.id}-${side}`, { searching: false, pages: 1 });
  const [retry, setRetry] = useState(0),
    [mutation, setMutation] = useState<
      {
        api: typeof api;
        origin: EntityDetail;
        other: EntityDetail;
        previous: EntitySummary | null;
        definition: EntityRelationDefinition;
        remove: boolean;
      } | null
    >(null);
  useLayoutEffect(() => {
    if (!mutation) return;
    onMutationChange?.(mutation.definition, side, mutation.api, mutation.origin.id, definition.id);
    return () => onMutationChange?.(null, side, mutation.api, mutation.origin.id, definition.id);
  }, [mutation, onMutationChange, side, definition.id]);
  const base = `/entity-relations/${definition.id}/${side}/${encodeURIComponent(entity.id)}`;
  const session = useMemo(
    () =>
      createPagedList<EntitySummary, LinkPage>({
        load: (cursor, signal) => api("GET", `${base}/links${query({ limit: 20, cursor })}`, undefined, signal),
      }),
    [api, base, entity.version, definition.version, retry, visible],
  );
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => {
    if (visible) void session.restore(view.pages);
    return () => session.cancel();
  }, [session]);
  useEffect(() => {
    if (state.completion?.source === "more") setView((old) => ({ ...old, pages: state.completion!.pages }));
  }, [state.completion]);
  useLayoutEffect(() => {
    setMutation(null);
    setPreparing(false);
    setError("");
    return () => preparation.current?.abort();
  }, [api, entity.id]);
  const def = state.page?.definition ?? definition,
    single = def.ends[side].cardinality === "one",
    current = state.page?.items[0],
    // An empty relation may be rebound while an uncertain attempt still owns its old endpoints.
    requiredKinds = new Set([
      ...definition.ends.map(end => end.type_id),
      ...def.ends.map(end => end.type_id),
      ...(mutation ? [mutation.origin.entity_type_id, mutation.other.entity_type_id,
        ...(mutation.previous ? [mutation.previous.entity_type_id] : [])] : []),
    ]),
    canRead = visible && [...requiredKinds].every(typeId => capability?.grants.some(grant =>
      grant.target_kind === "entity_type" && grant.target_id === typeId && (grant.access === "read" || grant.access === "write")
    )),
    canWrite = canRead && [...requiredKinds].every(typeId => capability?.grants.some(grant =>
      grant.target_kind === "entity_type" && grant.target_id === typeId && grant.access === "write"
    )),
    active = canRead && !readOnly && canWrite && !entity.deleted_at && !entity.type.archived && !def.archived;
  const prepare = async (item: Candidate, remove: boolean) => {
    if (!canRead || !canWrite || preparing || surface?.editor.current) return;
    const started = locationKey.current, c = new AbortController();
    preparation.current?.abort();
    preparation.current = c;
    setPreparing(true);
    setError("");
    try {
      const [origin, other, latest, page] = await Promise.all([
        api<EntityDetail>("GET", entityPath(entity.id), undefined, c.signal),
        api<EntityDetail>("GET", entityPath(item.id), undefined, c.signal),
        api<EntityRelationDefinition>("GET", `/entity-relation-definitions/${def.id}?purpose=business`, undefined, c.signal),
        api<LinkPage>("GET", `${base}/links`, undefined, c.signal),
      ]);
      if (!c.signal.aborted && started === locationKey.current && !surface?.editor.current) {
        setMutation({ api: ownerApi ?? api, origin, other, previous: page.items[0] ?? null, definition: latest, remove });
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "최신 자료를 읽지 못했습니다");
    } finally {
      if (!c.signal.aborted) setPreparing(false);
    }
  };
  return (
    <>
      <div ref={section} hidden={!canRead} tabIndex={-1} aria-label={`${def.ends[side].label} 관계`}>
        <RelatedSection
          title={def.ends[side].label + (def.archived ? " · 보관" : "")}
          views={!single && !readOnly}
          count={state.page?.items.length}
          hasMore={!single && !!state.page?.next_cursor}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {active && onCreate && (
                <Button variant="ghost" type="button"

                  disabled={preparing}
                  aria-label={`${def.ends[side].label} 작성해서 연결`}
                  data-relation-create={`${def.id}:${side}`}
                  onClick={() => onCreate(def, side)}
                ><PlusIcon data-icon="inline-start" />
                  작성
                </Button>
              )}
              {active && (
                <Button variant="ghost" type="button"

                  aria-expanded={view.searching}
                  aria-controls={searchId}
                  disabled={preparing || !!state.error || !state.page}
                  onClick={() => setView((v) => ({ ...v, searching: !v.searching }))}
                >{view.searching ? <XIcon data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />}
                  {view.searching ? "닫기" : single && current ? "변경" : "연결"}
                </Button>
              )}
              {!readOnly && canWrite && single && current && (
                <Button variant="ghost" type="button"

                  disabled={preparing}
                  onClick={() => void prepare(current, true)}
                ><UnlinkIcon data-icon="inline-start" />
                  해제
                </Button>
              )}
            </div>
          }
        >
          {error && <Notice kind="error">{error}</Notice>}
          {!!state.error && (
            <Notice kind="error">
              연결을 읽지 못했습니다.<Button variant="ghost" type="button" onClick={() => setRetry((n) => n + 1)}>다시 조회</Button>
            </Notice>
          )}
          {state.busy && !state.page && <p role="status">불러오는 중…</p>}
          {state.page && !state.page.items.length && !state.page.next_cursor && !state.busy && !state.error && <RelatedEmpty description={active ? onCreate ? "작성하거나 연결해 자료를 추가하세요." : "연결로 기존 자료를 선택하세요." : undefined} />}
          {single
            ? (
              current ? <p className="flex min-w-0 flex-col gap-3">
                {readOnly
                  ? <span>{current.title}</span>
                  : <DetailLink to={entityPath(current.id)}>{current.title}</DetailLink>}
                {(current.deleted_at || current.type.archived) && <span className="text-sm text-muted-foreground">
                  {current.deleted_at ? "삭제됨" : ""}
                  {current.type.archived ? " · 보관됨" : ""}
                </span>}
              </p> : null
            )
            : (
              <>
                {!!state.page?.items.length && <CollectionList columns={["자료 이름"]}>
                  {state.page?.items.map((item) => (
                    <CollectionItem key={item.id}>
                      {readOnly
                        ? (
                          <RelatedItem
                            title={item.title}
                            metadata={
                              <DataFields>
                                <div><dt>자료 종류</dt><dd>{item.type.label}</dd></div>
                                {item.deleted_at && <div><dt>상태</dt><dd>삭제됨</dd></div>}
                                {item.type.archived && <div><dt>종류 상태</dt><dd>보관됨</dd></div>}
                              </DataFields>
                            }
                          />
                        )
                        : (
                          <RelatedPreviewItem
                            title={item.title}
                            to={entityPath(item.id)}
                            metadata={item.type.archived ? <DataFields><div><dt>종류 상태</dt><dd>보관됨</dd></div></DataFields> : undefined}
                            action={canWrite ?
                              <Button variant="ghost" type="button"

                                aria-label={`${item.title} 연결 해제`}
                                disabled={preparing}
                                onClick={() => void prepare(item, true)}
                              ><UnlinkIcon data-icon="inline-start" />
                                해제
                              </Button> : undefined
                            }
                          />
                        )}
                    </CollectionItem>
                  ))}
                </CollectionList>}
                {state.page?.next_cursor && (
                  <Button variant="ghost" type="button" disabled={state.busy} onClick={() => void session.more()}>더 보기</Button>
                )}
              </>
            )}
          <div id={searchId} hidden={!view.searching}>
            {view.searching && active && (
              <RelationSearch
                kind="entity"
                relationContext={{ definition_id: def.id, side, origin_id: entity.id }}
                revision={entity.version}
                excluded={() => false}
                disabled={preparing}
                onChoose={(item) => void prepare(item, false)}
              />
            )}
          </div>
        </RelatedSection>
      </div>
      {mutation && (
        <FormModal
          open
          visible={canRead}
          title={mutation.remove ? "관계 연결 해제" : single ? "관계 연결 교체" : "관계 자료 연결"}
          submitLabel="저장"
          submitDisabled={!canWrite}
          dirty={false}
          confirmationOnly
          mutation={{
            target: `${mutation.origin.title} → ${mutation.definition.ends[side].label} → ${mutation.other.title}`,
            action: mutation.remove ? "해제" : single ? "수정" : "연결",
            message: !canWrite ? "현재 읽기 전용입니다. 초안과 처리 중인 요청은 유지됩니다." : undefined,
            data: single && !mutation.remove ? [
              { label: "기존", value: mutation.previous?.title ?? "연결 없음", fullWidth: true },
              { label: "변경", value: mutation.other.title, fullWidth: true },
            ] : undefined,
          }}
          validate={() => null}
          onClose={() => {
            setMutation(null);
            requestAnimationFrame(() => section.current?.focus());
          }}
          onRouteDiscard={() => setMutation(null)}
          onSubmit={async (key, memo) => {
            const mode = mutation.remove
              ? "unlink"
              : mutation.definition.ends[side].cardinality === "one"
              ? "replace"
              : "connect";
            const result = await api<RelationMutationResult>(
              "POST",
              `${base}/${mode}`,
              {
                other_id: mutation.other.id,
                expected_definition_version: mutation.definition.version,
                expected_version: mutation.origin.version,
                expected_other_version: mutation.other.version,
                ...(mode === "replace"
                  ? {
                    previous_other_id: mutation.previous?.id ?? null,
                    expected_previous_version: mutation.previous?.version ?? null,
                  }
                  : {}),
                ...memo,
              },
              undefined,
              key(),
            );
            setMutation(null);
            if (mode === "replace") setView((v) => ({ ...v, searching: false }));
            setRetry((n) => n + 1);
            onSaved(result.endpoint_versions.find((e) => e.id === entity.id)!.version);
            requestAnimationFrame(() => section.current?.focus());
          }}
        >
          {() =>
            single && !mutation.remove
              ? <p>기존: {mutation.previous?.title ?? "연결 없음"} → 변경: {mutation.other.title}</p>
              : null}
        </FormModal>
      )}
    </>
  );
}
