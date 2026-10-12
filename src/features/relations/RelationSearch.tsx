import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import { createPagedList } from "../collections/paged-list.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EntityDetail, EntitySummary } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { useDetailViewState } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { RelatedItem } from "../../components/RelatedItems.tsx";
import { api, query } from "../../lib/api.ts";

export type Candidate = {
  id: string;
  title: string;
  entityIds?: string[];
  identity?: string;
  type?: EntitySummary["type"];
};
type CandidatePage = { items: Candidate[]; next_cursor: string | null };
/** Saved relationships and draft selection expose the same search action. */
export function RelationSearchAction(
  { kind, expanded, controls, disabled = false, onToggle }: {
    kind: "entity" | "task";
    expanded: boolean;
    controls: string;
    disabled?: boolean;
    onToggle: () => void;
  },
) {
  const label = kind === "entity" ? "자료" : "할 일";
  return (
    <BodyAction
      icon={expanded ? "close" : "link"}
      data-relation-search-toggle={kind}
      aria-label={expanded ? `${label} 검색 닫기` : `${label} 연결`}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={onToggle}
    >
      {expanded ? "닫기" : "연결"}
    </BodyAction>
  );
}
/** Current-title lookup, shared by the two directions of the same relationship. */
export function RelationSearch(
  { kind, excluded, onChoose, disabled, revision, draftMode = false, linkCandidateFor, entityTypeId }: {
    kind: "entity" | "task";
    excluded: (item: Candidate) => boolean;
    onChoose: (item: Candidate) => void;
    disabled: boolean;
    revision?: number | EntityDetail["tasks"];
    draftMode?: boolean;
    linkCandidateFor?: string;
    entityTypeId?: string;
  },
) {
  const label = kind === "entity" ? "자료" : "할 일";
  const [view, setView] = useDetailViewState(`${draftMode ? "draft-" : ""}relation-search-${kind}`, {
    draft: "",
    pages: 1,
  });
  const draft = view.draft, setDraft = (draft: string) => setView({ draft, pages: 1 });
  const [composing, setComposing] = useState(false), [retry, setRetry] = useState(0);
  const immediate = useRef(false), keyword = draft.trim();
  const session = useMemo(() =>
    createPagedList<Candidate, CandidatePage>({
      load: async (cursor, signal) => {
        const page = kind === "entity"
          ? await api<{ items: EntitySummary[]; next_cursor: string | null }>(
            "GET",
            `/entities${
              query({ keyword, limit: 20, cursor, link_candidate_for: linkCandidateFor, entity_type_id: entityTypeId })
            }`,
            undefined,
            signal,
          )
          : await api<{ items: TaskResult[]; next_cursor: string | null }>(
            "GET",
            `/tasks${query({ keyword, limit: 20, cursor })}`,
            undefined,
            signal,
          );
        return {
          next_cursor: page.next_cursor,
          items: page.items.map((item) => ({
            id: item.id,
            title: item.title,
            ...("entity_type_id" in item
              ? { type: item.type, identity: `${item.type.label} · ${entityIdentityLabel(item)}` }
              : {}),
            ...("entity_ids" in item ? { entityIds: item.entity_ids } : {}),
          })),
        };
      },
    }), [keyword, composing, retry, kind, revision, linkCandidateFor, entityTypeId]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [waiting, setWaiting] = useState(!!keyword);
  useEffect(() => {
    const delay = immediate.current ? 0 : 300;
    immediate.current = false;
    setWaiting(!!keyword && !composing);
    if (!keyword || composing) return () => session.cancel();
    const timer = setTimeout(() => {
      setWaiting(false);
      void session.restore(view.pages);
    }, delay);
    return () => {
      clearTimeout(timer);
      session.cancel();
    };
  }, [session]);
  useEffect(() => {
    if (state.completion?.source === "more") setView((prior) => ({ ...prior, pages: state.completion!.pages }));
  }, [state.completion]);
  const result = state.page, pending = waiting || state.busy, failed = !!state.error;
  const more = () => session.more();
  return (
    <div className="related-search">
      <Field label={`${label} 제목 검색`}>
        {(props) => (
          <input
            {...props}
            autoFocus
            type="search"
            maxLength={100}
            className="input"
            placeholder="제목으로 검색"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (composing || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              immediate.current = true;
              setRetry((n) => n + 1);
            }}
          />
        )}
      </Field>
      {pending && <p className="secondary" role="status" aria-label="후보 검색">불러오는 중…</p>}
      {failed && (
        <>
          <Notice kind="error">검색하지 못했습니다.</Notice>
          <BodyAction disabled={pending || disabled} onClick={() => void session.retry()}>검색 다시 시도</BodyAction>
        </>
      )}
      {result && (
        <div className="related-search-results" role="group" aria-label={`${label} 검색 결과`}>
          {result.items.filter((item) => !item.type?.archived && !excluded(item)).map((item) => (
            <RelatedItem
              key={item.id}
              to={draftMode ? undefined : `/${kind === "entity" ? "entities" : "tasks"}/${encodeURIComponent(item.id)}`}
              restoreKey={`relation-candidate-${kind}-${item.id}`}
              title={item.title}
              metadata={item.identity && (
                <span>{item.type && <EntityTypeIcon id={item.type.icon_id} />} {item.identity}</span>
              )}
              action={
                <BodyAction
                  icon="link"
                  aria-disabled={disabled}
                  aria-label={`${item.title} 연결`}
                  onClick={() => {
                    if (!disabled) onChoose(item);
                  }}
                >
                  연결
                </BodyAction>
              }
            />
          ))}
          {!result.items.length && !pending && <p className="secondary">검색 결과가 없습니다.</p>}
          {result.next_cursor && (
            <BodyAction disabled={pending || disabled} onClick={more}>검색 결과 더 보기</BodyAction>
          )}
        </div>
      )}
    </div>
  );
}
