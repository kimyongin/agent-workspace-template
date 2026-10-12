import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import { CollectionList } from "../../components/Collection.tsx";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import type { EntityContext } from "@contracts/entity-links.ts";
import type { EntitySummary } from "@contracts/entity.ts";
import { useEffect, useState } from "react";
import { DetailLink as Link } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import "./entity.css";
import { RelationPicker } from "../relations/RelationPicker.tsx";
export function EntityPicker(
  { value, onChange, error, label = "자료" }: {
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    error?: string;
    label?: string;
  },
) {
  const { items, failed, retry } = useEntities();
  return (
    <div className="form">
      <Field label={label} error={error}>
        {(p) => (
          <select
            {...p}
            className="input"
            value={value ?? ""}
            disabled={!items}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">{items ? "미지정" : "불러오는 중…"}</option>
            {value && !items?.some((e) => e.id === value) && <option value={value}>현재 연결 ({value})</option>}
            {items?.map((e) => <option key={e.id} value={e.id}>{e.title} · {entityIdentityLabel(e)}</option>)}
          </select>
        )}
      </Field>
      {failed && (
        <>
          <Notice kind="error">엔터티를 불러오지 못했습니다.</Notice>
          <button
            className="btn"
            type="button"
            onClick={retry}
          >
            다시 시도
          </button>
        </>
      )}
    </div>
  );
}
export function EntityLink({ id }: { id: string | null | undefined }) {
  return id
    ? (
      <p className="secondary">
        연결 자료: <Link to={`/entities/${encodeURIComponent(id)}`}>자료 보기</Link>
      </p>
    )
    : null;
}

function useEntities() {
  const [items, setItems] = useState<EntitySummary[] | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setItems(null);
    (async () => {
      let cursor: string | null = null;
      const all: EntitySummary[] = [];
      do {
        const page: { items: EntitySummary[]; next_cursor: string | null } = await api(
          "GET",
          `/entities${query({ limit: 100, cursor })}`,
          undefined,
          controller.signal,
        );
        all.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      setItems(all);
    })().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [retry]);
  return { items, failed, retry: () => setRetry((n) => n + 1) };
}

/** Form selection uses the same search/card design as saved relationships. */
export function EntityMultiPicker(
  { value, context = [], onChange, error }: {
    value: string[];
    context?: EntityContext[];
    onChange: (ids: string[]) => void;
    error?: string;
  },
) {
  return <RelationPicker kind="entity" value={value} context={context} onChange={onChange} error={error} />;
}

export function EntityLinks(
  { ids, context = [] }: { ids?: string[]; context?: EntityContext[] },
) {
  if (!ids?.length) return null;
  return (
    <RelatedSection title="자료" count={ids.length}>
      <CollectionList>
        {ids.map((id) => {
          return (
            <li key={id}>
              <EntityLinkItem id={id} context={context} />
            </li>
          );
        })}
      </CollectionList>
    </RelatedSection>
  );
}

export function EntityLinkItem({ id, context = [] }: { id: string; context?: EntityContext[] }) {
  const capture = context.find((item) => item.id === id);
  return (
    <RelatedPreviewItem
      to={`/entities/${encodeURIComponent(id)}`}
      title={capture?.title ?? "연결된 엔터티"}
      metadata={<span>{id}</span>}
      restoreKey={`linked-entity-${id}`}
    />
  );
}
