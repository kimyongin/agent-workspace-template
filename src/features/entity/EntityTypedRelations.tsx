import { useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import type { EntityDetail, EntitySummary } from "@contracts/entity.ts";
import type { EntityRelationDefinition, EntityRelationDefinitionPage } from "@contracts/entity-relation.ts";
import type { RelationMutationResult } from "@contracts/entity-relation-links.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { api, query } from "../../lib/api.ts";
import { DetailLink, useDetailViewState } from "../../lib/detail-exploration.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { CollectionList } from "../../components/Collection.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
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
  const [definitions, setDefinitions] = useState<EntityRelationDefinition[]>([]),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
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
            query({ type_id: entity.entity_type_id, archived: "all", limit: 100, cursor })
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
  }, [entity.entity_type_id, entity.version, retry]);
  return (
    <>
      {error && (
        <Notice kind="error">
          관계 정의를 읽지 못했습니다.<BodyAction onClick={() => setRetry((n) => n + 1)}>관계 다시 조회</BodyAction>
        </Notice>
      )}
      {definitions.flatMap((def) =>
        def.ends.map((end, side) =>
          end.type_id === entity.entity_type_id
            ? (
              <EntityRelationSection
                key={`${def.id}-${side}`}
                entity={entity}
                definition={def}
                side={side as 0 | 1}
                onSaved={onSaved}
                onCreate={onCreate}
                readOnly={readOnly}
              />
            )
            : null
        )
      )}
    </>
  );
}
export function EntityRelationSection(
  { entity, definition, side, onSaved, onCreate, readOnly = false }: {
    readOnly?: boolean;
    entity: EntityDetail;
    definition: EntityRelationDefinition;
    side: 0 | 1;
    onSaved: (version: number) => void;
    onCreate?: (definition: EntityRelationDefinition, side: 0 | 1) => void;
  },
) {
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
        origin: EntityDetail;
        other: EntityDetail;
        previous: EntitySummary | null;
        definition: EntityRelationDefinition;
        remove: boolean;
      } | null
    >(null);
  const base = `/entity-relations/${definition.id}/${side}/${encodeURIComponent(entity.id)}`;
  const session = useMemo(
    () =>
      createPagedList<EntitySummary, LinkPage>({
        load: (cursor, signal) => api("GET", `${base}/links${query({ limit: 20, cursor })}`, undefined, signal),
      }),
    [base, entity.version, definition.version, retry],
  );
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => {
    void session.restore(view.pages);
    return () => session.cancel();
  }, [session]);
  useEffect(() => {
    if (state.completion?.source === "more") setView((old) => ({ ...old, pages: state.completion!.pages }));
  }, [state.completion]);
  useEffect(() => () => preparation.current?.abort(), [entity.id]);
  const def = state.page?.definition ?? definition,
    single = def.ends[side].cardinality === "one",
    current = state.page?.items[0],
    active = !readOnly && !entity.deleted_at && !entity.type.archived && !def.archived;
  const prepare = async (item: Candidate, remove: boolean) => {
    if (preparing || surface?.editor.current) return;
    const started = locationKey.current, c = new AbortController();
    preparation.current?.abort();
    preparation.current = c;
    setPreparing(true);
    setError("");
    try {
      const [origin, other, latest, page] = await Promise.all([
        api<EntityDetail>("GET", entityPath(entity.id), undefined, c.signal),
        api<EntityDetail>("GET", entityPath(item.id), undefined, c.signal),
        api<EntityRelationDefinition>("GET", `/entity-relation-definitions/${def.id}`, undefined, c.signal),
        api<LinkPage>("GET", `${base}/links`, undefined, c.signal),
      ]);
      if (!c.signal.aborted && started === locationKey.current && !surface?.editor.current) {
        setMutation({ origin, other, previous: page.items[0] ?? null, definition: latest, remove });
      }
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "최신 자료를 읽지 못했습니다");
    } finally {
      if (!c.signal.aborted) setPreparing(false);
    }
  };
  return (
    <>
      <div ref={section} tabIndex={-1} aria-label={`${def.ends[side].label} 관계`}>
        <RelatedSection
          title={def.ends[side].label + (def.archived ? " · 보관" : "")}
          views={!single && !readOnly}
          count={single ? undefined : state.page?.items.length}
          hasMore={!single && !!state.page?.next_cursor}
          action={
            <div className="actions">
              {active && onCreate && (
                <BodyAction
                  icon="create"
                  disabled={preparing}
                  aria-label={`${def.ends[side].label} 작성해서 연결`}
                  data-relation-create={`${def.id}:${side}`}
                  onClick={() => onCreate(def, side)}
                >
                  작성
                </BodyAction>
              )}
              {active && (
                <BodyAction
                  icon={view.searching ? "close" : "link"}
                  aria-expanded={view.searching}
                  aria-controls={searchId}
                  disabled={preparing || !!state.error || !state.page}
                  onClick={() => setView((v) => ({ ...v, searching: !v.searching }))}
                >
                  {view.searching ? "닫기" : single && current ? "변경" : "연결"}
                </BodyAction>
              )}
              {!readOnly && single && current && (
                <BodyAction
                  icon="unlink"
                  disabled={preparing}
                  onClick={() => void prepare(current, true)}
                >
                  해제
                </BodyAction>
              )}
            </div>
          }
        >
          {error && <Notice kind="error">{error}</Notice>}
          {!!state.error && (
            <Notice kind="error">
              연결을 읽지 못했습니다.<BodyAction onClick={() => setRetry((n) => n + 1)}>다시 조회</BodyAction>
            </Notice>
          )}
          {state.busy && !state.page && <p role="status">불러오는 중…</p>}
          {single
            ? (
              <p className="entity-single-relation">
                {current
                  ? (
                    <>
                      {readOnly
                        ? <span>{current.title}</span>
                        : <DetailLink to={entityPath(current.id)}>{current.title}</DetailLink>}
                      <span className="secondary">
                        {current.deleted_at ? " · 삭제됨" : ""}
                        {current.type.archived ? " · 보관됨" : ""}
                      </span>
                    </>
                  )
                  : state.page
                  ? "연결된 자료가 없습니다."
                  : null}
              </p>
            )
            : (
              <>
                <CollectionList>
                  {state.page?.items.map((item) => (
                    <li key={item.id}>
                      {readOnly
                        ? (
                          <RelatedItem
                            title={item.title}
                            metadata={
                              <>
                                {item.type.label}
                                {item.deleted_at ? " · 삭제됨" : ""}
                                {item.type.archived ? " · 보관됨" : ""}
                              </>
                            }
                          />
                        )
                        : (
                          <RelatedPreviewItem
                            title={item.title}
                            to={entityPath(item.id)}
                            metadata={
                              <>
                                {item.type.label}
                                {item.deleted_at ? " · 삭제됨" : ""}
                                {item.type.archived ? " · 보관됨" : ""}
                              </>
                            }
                            action={
                              <BodyAction
                                icon="unlink"
                                aria-label={`${item.title} 연결 해제`}
                                disabled={preparing}
                                onClick={() => void prepare(item, true)}
                              >
                                해제
                              </BodyAction>
                            }
                          />
                        )}
                    </li>
                  ))}
                </CollectionList>
                {state.page?.next_cursor && (
                  <BodyAction disabled={state.busy} onClick={() => void session.more()}>더 보기</BodyAction>
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
          title={mutation.remove ? "관계 연결 해제" : single ? "관계 연결 교체" : "관계 자료 연결"}
          submitLabel="저장"
          dirty={false}
          confirmationOnly
          mutation={{
            target: `${mutation.origin.title} → ${mutation.definition.ends[side].label} → ${mutation.other.title}`,
            action: mutation.remove ? "해제" : single ? "수정" : "연결",
            message: single && !mutation.remove
              ? `기존: ${mutation.previous?.title ?? "연결 없음"} → 변경: ${mutation.other.title}`
              : undefined,
          }}
          validate={() => null}
          onClose={() => setMutation(null)}
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
