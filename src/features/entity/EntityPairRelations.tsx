import { useContext, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { EntityDetail, EntitySummary } from "@contracts/entity.ts";
import { entityPath } from "@contracts/entity-identity.ts";
import { entityPairResult } from "@contracts/entity-pairs.ts";
import { SurfaceContext } from "../../components/Modal.tsx";
import { FormModal } from "../../components/ContentForm.tsx";
import { CollectionList } from "../../components/Collection.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { Notice } from "../../components/Field.tsx";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { api, query } from "../../lib/api.ts";
import { createPagedList } from "../collections/paged-list.ts";
import { type Candidate, RelationSearch, RelationSearchAction } from "../relations/RelationSearch.tsx";
import { EntityTypeIcon } from "./EntityTypeIcon.tsx";

type LinkPage = { items: EntitySummary[]; next_cursor: string | null };
export function EntityPairRelations({ entity, onSaved }: { entity: EntityDetail; onSaved: (version: number) => void }) {
  const surface = useContext(SurfaceContext), searchId = useId();
  const [searching, setSearching] = useState(false),
    [retry, setRetry] = useState(0),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<{ origin: EntityDetail; other: EntityDetail; remove: boolean } | null>(null);
  const session = useMemo(
    () =>
      createPagedList<EntitySummary, LinkPage>({
        load: (cursor, signal) =>
          api("GET", `${entityPath(entity.id)}/links${query({ limit: 20, cursor })}`, undefined, signal),
      }),
    [entity.id, entity.version, retry],
  );
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => {
    void session.restore(1);
    return () => session.cancel();
  }, [session]);
  const prepare = async (item: Candidate, remove: boolean) => {
    if (preparing || surface?.editor.current) return;
    setPreparing(true);
    setError(null);
    try {
      const [origin, other] = await Promise.all([
        api<EntityDetail>("GET", entityPath(entity.id)),
        api<EntityDetail>("GET", entityPath(item.id)),
      ]);
      if (!surface?.editor.current) setMutation({ origin, other, remove });
    } catch (e) {
      setError(e instanceof Error ? e.message : "최신 자료를 확인하지 못했습니다.");
    } finally {
      setPreparing(false);
    }
  };
  const active = !entity.deleted_at && !entity.type.archived;
  return (
    <>
      <RelatedSection
        title="연결된 자료"
        action={active && (
          <RelationSearchAction
            kind="entity"
            expanded={searching}
            controls={searchId}
            disabled={preparing}
            onToggle={() => setSearching((v) => !v)}
          />
        )}
      >
        {error && <Notice kind="error">{error}</Notice>}
        {!!state.error && (
          <>
            <Notice kind="error">연결을 불러오지 못했습니다.</Notice>
            <button className="btn" onClick={() => setRetry((v) => v + 1)}>다시 시도</button>
          </>
        )}
        {state.busy && !state.page && <p role="status">불러오는 중…</p>}
        {state.page && !state.page.items.length && <p className="secondary">연결된 자료가 없습니다.</p>}
        <CollectionList>
          {state.page?.items.map((item) => (
            <li key={item.id}>
              <RelatedItem
                title={item.title}
                to={entityPath(item.id)}
                metadata={
                  <>
                    <EntityTypeIcon id={item.type.icon_id} /> {item.type.label}
                    {item.deleted_at ? " · 삭제됨" : item.type.archived ? " · 보관됨" : ""}
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
            </li>
          ))}
        </CollectionList>
        {state.page?.next_cursor && (
          <button className="btn" disabled={state.busy} onClick={() => void session.more()}>더 보기</button>
        )}
        <div id={searchId} hidden={!searching}>
          {searching && active && (
            <RelationSearch
              kind="entity"
              revision={entity.version}
              linkCandidateFor={entity.id}
              excluded={() => false}
              disabled={preparing}
              onChoose={(item) => void prepare(item, false)}
            />
          )}
        </div>
      </RelatedSection>
      {mutation && (
        <FormModal
          open
          title={mutation.remove ? "자료 연결 해제" : "자료 연결"}
          submitLabel="저장"
          dirty={false}
          confirmationOnly
          mutation={{
            target: `${mutation.origin.title} ↔ ${mutation.other.title}`,
            action: mutation.remove ? "해제" : "연결",
          }}
          validate={() => null}
          onClose={() => setMutation(null)}
          onRouteDiscard={() => setMutation(null)}
          onSubmit={async (requestKey, memo) => {
            const path = mutation.remove
              ? `${entityPath(mutation.origin.id)}/links/${encodeURIComponent(mutation.other.id)}/delete`
              : `${entityPath(mutation.origin.id)}/links`;
            const result = entityPairResult.parse(
              await api(
                "POST",
                path,
                {
                  expected_version: mutation.origin.version,
                  expected_other_version: mutation.other.version,
                  ...(!mutation.remove ? { other_id: mutation.other.id } : {}),
                  ...memo,
                },
                undefined,
                requestKey(),
              ),
            );
            setMutation(null);
            setRetry((v) => v + 1);
            onSaved(result.endpoint_versions.find((e) => e.id === entity.id)!.version);
          }}
        >
          {() => null}
        </FormModal>
      )}
    </>
  );
}
