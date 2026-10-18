import { cn } from "../../lib/utils.ts";
import { Button } from "../../components/ui/button.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type { EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { api } from "../../lib/api.ts";
import { displayedProperty } from "./property-fields.tsx";
import { Notice } from "../../components/Field.tsx";
import { DetailTitle } from "../../components/Modal.tsx";
export function EntityProperties(
  { entity, identity, onReadyChange, selection = "all", omitRepresentative = false, onRepresentativeLabel }: {
    entity: EntityValues;
    identity?: ReactNode;
    selection?: "all" | "list";
    omitRepresentative?: boolean;
    onRepresentativeLabel?: (label: string) => void;
    onReadyChange?: (ready: boolean) => void;
  },
) {
  const [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const gridClassName = cn(
    "grid min-w-0 gap-4 [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere",
    selection === "list"
      ? "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] [&_dt]:text-xs"
      : "grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] [&_dt]:text-sm",
  );
  const key = `${entity.entity_type_id}:${entity.current_schema_version}:${retry}`;
  const [readKey, setReadKey] = useState(key);
  if (readKey !== key) {
    setReadKey(key);
    setDefinition(null);
    setFailed(false);
  }
  useLayoutEffect(() => onReadyChange?.(!!definition || failed), [definition, failed, onReadyChange]);
  useLayoutEffect(() => {
    if (definition) {
      onRepresentativeLabel?.(
        definition.schema.properties[schemaPresentation(definition).representative].title ?? "자료 이름",
      );
    }
  }, [definition, onRepresentativeLabel]);
  useEffect(() => {
    const c = new AbortController();
    setDefinition(null);
    setFailed(false);
    void api<EntitySchemaResult>(
      "GET",
      `/entity-types/${entity.entity_type_id}/schema?schema_version=${entity.current_schema_version}`,
      undefined,
      c.signal,
    ).then((value) => {
      if (!c.signal.aborted) setDefinition(value);
    }).catch(() => {
      if (!c.signal.aborted) setFailed(true);
    });
    return () => c.abort();
  }, [entity.entity_type_id, entity.current_schema_version, retry]);
  if (failed) {
    return (
      <>
        <Notice kind="error">속성 정의를 불러오지 못했습니다.</Notice>
        <Button variant="outline"  onClick={() => setRetry((n) => n + 1)}>속성 정의 다시 조회</Button>
        {identity && <dl className={gridClassName}>{identity}</dl>}
      </>
    );
  }
  if (!definition) return <p role="status">속성 정의를 불러오는 중…</p>;
  return (
    <dl className={gridClassName}>
      {(selection === "list"
        ? [
          schemaPresentation(definition).representative,
          ...schemaPresentation(definition).list_columns.filter((key) =>
            key !== schemaPresentation(definition).representative
          ),
        ]
        : [
          schemaPresentation(definition).representative,
          ...schemaPresentation(definition).order.filter((key) =>
            key !== schemaPresentation(definition).representative
          ),
        ]).filter((key) => !omitRepresentative || key !== schemaPresentation(definition).representative).map((
          key,
          index,
        ) => (
          <Fragment key={key}>
            <div
              className={cn(key === schemaPresentation(definition).representative
                ? "col-span-full col-span-full"
                : undefined)}
            >
              <dt>
                {definition.schema.properties[key].title ?? key}
                {schemaPresentation(definition).archived.includes(key)
                  ? " · 보관"
                  : definition.schema.properties[key].readOnly
                  ? " · 읽기 전용"
                  : ""}
              </dt>
              <dd>
                {selection === "all" && key === schemaPresentation(definition).representative
                  ? (
                    <DetailTitle>
                      {displayedProperty(
                        definition.schema.properties[key],
                        entity.properties[key],
                        schemaPresentation(definition).option_labels[key],
                      )}
                    </DetailTitle>
                  )
                  : displayedProperty(
                    definition.schema.properties[key],
                    entity.properties[key],
                    schemaPresentation(definition).option_labels[key],
                  )}
              </dd>
            </div>
            {index === 0 && identity}
          </Fragment>
        ))}
    </dl>
  );
}
