import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import type { EntityContext } from "@contracts/entity-links.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { useEffect, useId, useRef, useState } from "react";
import type { EntitySummary } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { api } from "../../lib/api.ts";
import { type Candidate, RelationSearch, RelationSearchAction } from "./RelationSearch.tsx";

/** Draft membership only; callers decide when and how to persist the relationship. */
export function RelationPicker({ kind, value, context = [], onChange, error }: {
  kind: "entity" | "task";
  value: string[];
  context?: Array<Pick<EntityContext, "id" | "title" | "type" | "schema_version">>;
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const label = kind === "entity" ? "자료" : "할 일";
  const [names, setNames] = useState(() => new Map(context.map((item) => [item.id, item.title])));
  const [types, setTypes] = useState(() =>
    new Map(context.filter((item) => item.type).map((item) => [item.id, item.type!]))
  );
  const [identities, setIdentities] = useState(() => new Map<string, string>());
  const [pending, setPending] = useState(() => new Set<string>()),
    [failed, setFailed] = useState(() => new Set<string>());
  const [retry, setRetry] = useState(0);
  const [searching, setSearching] = useState(false), searchId = useId();
  const root = useRef<HTMLDivElement>(null), nextFocus = useRef<string | null>(null);
  const selection = value.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const unresolved = value.filter((id) => !names.has(id) || kind === "entity" && !identities.has(id));
    setPending(new Set(unresolved));
    setFailed(new Set());
    for (const id of unresolved) {
      void api<EntitySummary | TaskResult>(
        "GET",
        `/${kind === "entity" ? "entities" : "tasks"}/${encodeURIComponent(id)}`,
        undefined,
        controller.signal,
      )
        .then((item) => {
          if (!controller.signal.aborted) {
            setNames((prior) => prior.has(id) ? prior : new Map(prior).set(id, item.title));
            if ("type" in item) {
              setTypes((prior) => prior.has(id) ? prior : new Map(prior).set(id, item.type));
              setIdentities((prior) => new Map(prior).set(id, entityIdentityLabel(item)));
            }
          }
        }).catch(() => {
          if (!controller.signal.aborted) setFailed((prior) => new Set(prior).add(id));
        }).finally(() => {
          if (!controller.signal.aborted) {
            setPending((prior) => {
              const next = new Set(prior);
              next.delete(id);
              return next;
            });
          }
        });
    }
    return () => controller.abort();
  }, [kind, selection, retry]);
  useEffect(() => {
    if (nextFocus.current === null) return;
    const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-selection]") ?? []).find(
      (button) => button.dataset.selection === nextFocus.current,
    );
    (button ?? root.current?.querySelector<HTMLInputElement>("input[type=search]") ??
      root.current?.querySelector<HTMLButtonElement>("button[data-relation-search-toggle]"))?.focus();
    nextFocus.current = null;
  }, [selection]);
  const choose = (item: Candidate) => {
    setNames((prior) => new Map(prior).set(item.id, item.title));
    if (item.type) setTypes((prior) => new Map(prior).set(item.id, item.type!));
    if (item.identity) setIdentities((prior) => new Map(prior).set(item.id, item.identity!));
    nextFocus.current = item.id;
    onChange(kind === "task" ? [item.id] : [...value, item.id].sort());
  };
  return (
    <div ref={root} className="form">
      <RelatedSection
        views={false}
        title={label}
        count={value.length}
        action={
          <RelationSearchAction
            kind={kind}
            expanded={searching}
            controls={searchId}
            onToggle={() => setSearching((value) => !value)}
          />
        }
      >
        {error && <p className="error-text" role="alert">{error}</p>}
        {[...failed].some((id) => value.includes(id)) && (
          <p className="error-text" role="alert">
            선택한 {label} 정보를 확인하지 못했습니다.{" "}
            <BodyAction icon="reset" onClick={() => setRetry((value) => value + 1)}>다시 조회</BodyAction>
          </p>
        )}
        <div id={searchId} hidden={!searching}>
          {searching && (
            <RelationSearch
              draftMode
              kind={kind}
              disabled={false}
              excluded={(item) => value.includes(item.id)}
              onChoose={choose}
            />
          )}
        </div>
        <ul className="related-items" aria-label={`선택한 ${label}`}>
          {value.map((id) => (
            <li key={id}>
              <RelatedItem
                title={names.get(id) ?? label}
                titleLabel={kind === "task" ? "제목" : "자료 이름"}
                metadata={kind === "entity"
                  ? (
                    <dl className="key-value-grid">
                      {types.get(id) && <div><dt>자료 종류</dt><dd><EntityTypeIcon id={types.get(id)!.icon_id} /> {types.get(id)!.label}</dd></div>}
                      {identities.has(id) && <div><dt>자료 식별</dt><dd>{identities.get(id)}</dd></div>}
                      {pending.has(id) && <div><dt>조회 상태</dt><dd role="status">확인 중…</dd></div>}
                      {failed.has(id) && <div><dt>조회 상태</dt><dd>정보 확인 필요</dd></div>}
                    </dl>
                  )
                  : undefined}
                action={
                  <BodyAction
                    icon="unlink"
                    data-selection={id}
                    aria-label={`${names.get(id) ?? label} 해제`}
                    onClick={() => {
                      nextFocus.current = "";
                      onChange(value.filter((value) => value !== id));
                    }}
                  >
                    해제
                  </BodyAction>
                }
              />
            </li>
          ))}
        </ul>
      </RelatedSection>
    </div>
  );
}
