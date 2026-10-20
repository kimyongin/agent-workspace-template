import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { CollectionItem, CollectionList } from "../../components/Collection.tsx";
import { Button } from "../../components/ui/button.tsx";
import { XIcon, LinkIcon } from "lucide-react";
import { Input } from "../../components/ui/input.tsx";
import type { RelationLocation } from "@contracts/entity-relation-links.ts";
import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import { createPagedList } from "../collections/paged-list.ts";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EntityDetail, EntitySummary } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { useDetailViewState } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { RelatedItem } from "../../components/RelatedItems.tsx";
import { query } from "../../lib/api.ts";

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
    <Button variant="ghost" type="button"

      data-relation-search-toggle={kind}
      aria-label={expanded ? `${label} 검색 닫기` : `${label} 연결`}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={onToggle}
    >{expanded ? <XIcon data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />}
      {expanded ? "닫기" : "연결"}
    </Button>
  );
}
/** Current-title lookup, shared by the two directions of the same relationship. */
export function RelationSearch(
  { kind, excluded, onChoose, disabled, revision, draftMode = false, entityTypeId, relationContext }: {
    kind: "entity" | "task";
    excluded: (item: Candidate) => boolean;
    onChoose: (item: Candidate) => void;
    disabled: boolean;
    revision?: number | EntityDetail["tasks"];
    draftMode?: boolean;
    entityTypeId?: string;
    relationContext?: RelationLocation;
  },
) {
  const api = useApi();
  const capabilities = useWorkspaceCapabilities();
  const permissionKey = JSON.stringify(capabilities?.grants ?? []);
  const readable = (item: Candidate) => capabilities?.grants.some(grant =>
    kind === "task" ? grant.target_kind === "tasks" && grant.target_id === "*" && (grant.access === "read" || grant.access === "write")
      : !!item.type && grant.target_kind === "entity_type" && grant.target_id === item.type.id && (grant.access === "read" || grant.access === "write")
  ) ?? false;
  const label = kind === "entity" ? "자료" : "할 일";
  const [view, setView] = useDetailViewState(
    `${draftMode ? "draft-" : ""}relation-search-${kind}${
      relationContext ? `-${relationContext.definition_id}-${relationContext.side}` : ""
    }`,
    {
      draft: "",
      pages: 1,
    },
  );
  const draft = view.draft, setDraft = (draft: string) => setView({ draft, pages: 1 });
  const [composing, setComposing] = useState(false), [retry, setRetry] = useState(0);
  const immediate = useRef(false), keyword = draft.trim();
  const session = useMemo(() =>
    createPagedList<Candidate, CandidatePage>({
      load: async (cursor, signal) => {
        const page = kind === "entity"
          ? await api<{ items: EntitySummary[]; next_cursor: string | null }>(
            "GET",
            relationContext
              ? `/entity-relations/${relationContext.definition_id}/${relationContext.side}/${
                encodeURIComponent(relationContext.origin_id)
              }/candidates${query({ q: keyword, limit: 20, cursor })}`
              : `/entities${
                query({
                  keyword,
                  limit: 20,
                  cursor,
                  entity_type_id: entityTypeId,
                })
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
            ...("entity_type_id" in item ? { type: item.type, identity: entityIdentityLabel(item) } : {}),
            ...("entity_ids" in item ? { entityIds: item.entity_ids } : {}),
          })),
        };
      },
    }), [
    api,
    permissionKey,
    keyword,
    composing,
    retry,
    kind,
    revision,
    entityTypeId,
    relationContext?.definition_id,
    relationContext?.side,
    relationContext?.origin_id,
  ]);
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
  const candidates = result?.items.filter((item) => !item.type?.archived && readable(item) && !excluded(item)) ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={pending || undefined}>
      <Field label={`${label} 제목 검색`}>
        {(props) => (
          <Input
            {...props}
            autoFocus
            type="search"
            maxLength={100}

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
      {pending && <p className="text-sm text-muted-foreground" role="status" aria-label="후보 검색">불러오는 중…</p>}
      {failed && (
        <>
          <Notice kind="error">검색하지 못했습니다.</Notice>
          <Button variant="ghost" type="button" disabled={pending || disabled} onClick={() => void session.retry()}>검색 다시 시도</Button>
        </>
      )}
      {result && (
        <div className="flex min-w-0 max-h-[28rem] flex-col gap-3 overflow-y-auto" role="group" aria-label={`${label} 검색 결과`}>
          {candidates.length > 0 && <CollectionList disclosureColumn={false} view="table" label={`${label} 검색 결과`} columns={kind === "entity" ? ["자료 이름", "자료 종류", "자료 식별", "선택"] : ["제목", "선택"]}>
            {candidates.map((item) => {
              const choose = <Button variant="ghost" type="button" aria-disabled={disabled} aria-label={`${item.title} 연결`} onClick={() => { if (!disabled && readable(item)) onChoose(item); }}><LinkIcon data-icon="inline-start" />연결</Button>;
              return <CollectionItem key={item.id}><RelatedItem
                to={draftMode ? undefined : `/${kind === "entity" ? "entities" : "tasks"}/${encodeURIComponent(item.id)}`}
                restoreKey={`relation-candidate-${kind}-${item.id}`}
                title={item.title}
                cells={kind === "entity" ? [item.type ? item.type.label : "—", item.identity ?? "—", choose] : [choose]}
              /></CollectionItem>;
            })}
          </CollectionList>}
          {!candidates.length && !pending && !failed && (
            <p className="text-sm text-muted-foreground">
              {!result.items.some(readable)
                ? "검색 결과가 없습니다."
                : result.next_cursor
                ? "현재 결과에 연결할 수 있는 항목이 없습니다."
                : "연결할 수 있는 결과가 없습니다."}
            </p>
          )}
          {result.next_cursor && (
            <Button variant="ghost" type="button" disabled={pending || disabled} onClick={more}>검색 결과 더 보기</Button>
          )}
        </div>
      )}
    </div>
  );
}
