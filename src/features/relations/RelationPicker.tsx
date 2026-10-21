import { useApi } from "../../lib/api-context.tsx";
import { CollectionItem, CollectionList } from "../../components/Collection.tsx";
import { FieldGroup } from "../../components/ui/field.tsx";
import { Button } from "../../components/ui/button.tsx";
import { RotateCcwIcon, UnlinkIcon } from "lucide-react";
import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import type { EntityContext } from "@contracts/entity-links.ts";

import { useEffect, useId, useRef, useState } from "react";
import type { EntitySummary } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedEmpty, RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";

import { type Candidate, RelationSearch, RelationSearchAction } from "./RelationSearch.tsx";

/** Draft membership only; callers decide when and how to persist the relationship. */
export function RelationPicker({ kind, value, context = [], onChange, error, disabled = false, canReadEntityType }: {
  kind: "entity" | "task";
  value: string[];
  context?: Array<Pick<EntityContext, "id" | "title" | "type" | "schema_version">>;
  onChange: (ids: string[]) => void;
  error?: string;
  disabled?: boolean;
  canReadEntityType?: (typeId: string) => boolean;
}) {
  const api = useApi();
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
  const readable = (id: string) => !canReadEntityType || !!types.get(id) && canReadEntityType(types.get(id)!.id);
  const shown = value.filter(readable);
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
    if (disabled || canReadEntityType && (!item.type || !canReadEntityType(item.type.id))) return;
    setNames((prior) => new Map(prior).set(item.id, item.title));
    if (item.type) setTypes((prior) => new Map(prior).set(item.id, item.type!));
    if (item.identity) setIdentities((prior) => new Map(prior).set(item.id, item.identity!));
    nextFocus.current = item.id;
    onChange(kind === "task" ? [item.id] : [...value, item.id].sort());
  };
  return (
    <FieldGroup ref={root} className="flex min-w-0 flex-col gap-5">
      <RelatedSection
        views={false}
        title={label}
        count={shown.length === value.length ? shown.length : undefined}
        action={
          <RelationSearchAction
            kind={kind}
            expanded={searching}
            controls={searchId}
            disabled={disabled}
            onToggle={() => setSearching((value) => !value)}
          />
        }
      >
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {[...failed].some((id) => shown.includes(id)) && (
          <p className="text-sm text-destructive" role="alert">
            선택한 {label} 정보를 확인하지 못했습니다.{" "}
            <Button variant="ghost" type="button"  onClick={() => setRetry((value) => value + 1)}><RotateCcwIcon data-icon="inline-start" />다시 조회</Button>
          </p>
        )}
        <div id={searchId} hidden={!searching}>
          {searching && (
            <RelationSearch
              draftMode
              kind={kind}
              disabled={disabled}
              excluded={(item) => value.includes(item.id) || !!canReadEntityType && (!item.type || !canReadEntityType(item.type.id))}
              onChoose={choose}
            />
          )}
        </div>
        {!value.length && <RelatedEmpty title={kind === "entity" ? "연결된 자료가 없습니다." : "연결된 할 일이 없습니다."} description={!disabled ? "연결로 기존 항목을 선택하세요." : undefined} />}
        {shown.length > 0 && <CollectionList disclosureColumn={false} view="table" label={`선택한 ${label}`} columns={kind === "entity" ? ["자료 이름", "자료 종류", "자료 식별", "선택"] : ["제목", "선택"]}>
          {shown.map((id) => {
            const remove = <Button variant="ghost" type="button" disabled={disabled} data-selection={id}
              aria-label={`${names.get(id) ?? label} 해제`} onClick={() => { if (disabled || !readable(id)) return; nextFocus.current = ""; onChange(value.filter(value => value !== id)); }}>
              <UnlinkIcon data-icon="inline-start" />해제
            </Button>;
            const identity = <>
              {identities.get(id) ?? "—"}
              {pending.has(id) && <p role="status">조회 상태: 확인 중…</p>}
              {failed.has(id) && <p>조회 상태: 정보 확인 필요</p>}
            </>;
            return <CollectionItem key={id}><RelatedItem title={names.get(id) ?? label}
              cells={kind === "entity" ? [types.get(id) ? types.get(id)!.label : "—", identity, remove] : [remove]}
            /></CollectionItem>;
          })}
        </CollectionList>}
      </RelatedSection>
    </FieldGroup>
  );
}
