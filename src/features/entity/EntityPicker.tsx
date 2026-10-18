import { useApi } from "../../lib/api-context.tsx";
import { FieldGroup } from "../../components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Button } from "../../components/ui/button.tsx";
import { EntityTypeIcon } from "./EntityTypeIcon.tsx";
import { entityIdentityLabel } from "@contracts/entity-identity.ts";
import { CollectionItem, CollectionList  } from "../../components/Collection.tsx";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import type { EntityContext } from "@contracts/entity-links.ts";
import type { EntitySummary } from "@contracts/entity.ts";
import { useEffect, useState } from "react";
import { DetailLink as Link } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { query } from "../../lib/api.ts";
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
    <FieldGroup className="flex min-w-0 flex-col gap-5">
      <Field label={label} error={error}>
        {(p) => (
          <NativeSelect
            {...p}

            value={value ?? ""}
            disabled={!items}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <NativeSelectOption value="">{items ? "미지정" : "불러오는 중…"}</NativeSelectOption>
            {value && !items?.some((e) => e.id === value) && <NativeSelectOption value={value}>현재 연결 ({value})</NativeSelectOption>}
            {items?.map((e) => (
              <NativeSelectOption key={e.id} value={e.id}>{e.type.label} · {e.title} · {entityIdentityLabel(e)}</NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      {failed && (
        <>
          <Notice kind="error">자료를 불러오지 못했습니다.</Notice>
          <Button variant="outline"

            type="button"
            onClick={retry}
          >
            다시 시도
          </Button>
        </>
      )}
    </FieldGroup>
  );
}
export function EntityLink({ id }: { id: string | null | undefined }) {
  return id
    ? (
      <p className="text-sm text-muted-foreground">
        연결 자료: <Link to={`/entities/${encodeURIComponent(id)}`}>자료 보기</Link>
      </p>
    )
    : null;
}

function useEntities() {
  const api = useApi();
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
  { value, context = [], onChange, error, disabled = false }: {
    value: string[];
    context?: EntityContext[];
    disabled?: boolean;
    onChange: (ids: string[]) => void;
    error?: string;
  },
) {
  return <RelationPicker disabled={disabled} kind="entity" value={value} context={context} onChange={onChange} error={error} />;
}

export function EntityLinks(
  { ids, context = [] }: { ids?: string[]; context?: EntityContext[] },
) {
  if (!ids?.length) return null;
  return (
    <RelatedSection title="연결된 자료" count={ids.length}>
      <CollectionList columns={["자료 이름"]}>
        {ids.map((id) => {
          return (
            <CollectionItem key={id}>
              <EntityLinkItem id={id} context={context} />
            </CollectionItem>
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
      title={capture?.title ?? "연결된 자료"}
      metadata={
        <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
          {capture?.type && <div><dt>당시 자료 종류</dt><dd><EntityTypeIcon id={capture.type.icon_id} /> {capture.type.label}</dd></div>}
          {capture?.type && <div><dt>당시 입력 항목 버전</dt><dd>{capture.schema_version ?? "확인 필요"}</dd></div>}
          <div className="col-span-full"><dt>자료 식별</dt><dd>{id}</dd></div>
        </dl>
      }
      restoreKey={`linked-entity-${id}`}
    />
  );
}
