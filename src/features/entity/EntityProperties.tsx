import { useApi } from "../../lib/api-context.tsx";
import { ApiError } from "../../lib/api.ts";
import { DataFields } from "../../components/DataFields.tsx";
import { Button } from "../../components/ui/button.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { useContext, useEffect, useLayoutEffect, useState } from "react";
import { DetailTabContext, WorkspaceContext } from "../details/workspace-context.ts";
import type { EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";

import { displayedProperty, longPropertyText } from "./property-fields.tsx";
import { Notice } from "../../components/Field.tsx";
export function EntityProperties(
  { entity, onReadyChange, activeOnly = false }: {
    entity: EntityValues;
    activeOnly?: boolean;
    onReadyChange?: (ready: boolean) => void;
  },
) {
  const api = useApi();
  const active = useContext(DetailTabContext)?.active ?? true;
  const workspaceRevision = useContext(WorkspaceContext)?.revision ?? 0;
  const [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [failed, setFailed] = useState(false),
    [refreshing, setRefreshing] = useState(true),
    [retry, setRetry] = useState(0);
  const key = `${entity.entity_type_id}:${entity.current_schema_version}`;
  const [readKey, setReadKey] = useState({ api, key });
  if (readKey.key !== key || readKey.api !== api) {
    setReadKey({ api, key });
    setDefinition(null);
    setFailed(false);
  }
  useLayoutEffect(() => onReadyChange?.(!refreshing && (!!definition || failed)), [definition, failed, refreshing, onReadyChange]);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    // Current number names can change without a schema or material version change.
    // Keep the layout while reactivation, a material read or a saved registry update refreshes names.
    setRefreshing(true);
    setFailed(false);
    void api<EntitySchemaResult>(
      "GET",
      `/entity-types/${entity.entity_type_id}/schema?schema_version=${entity.current_schema_version}`,
      undefined,
      c.signal,
    ).then((value) => {
      if (!c.signal.aborted) setDefinition(value);
    }).catch((error) => {
      if (!c.signal.aborted) {
        if (!(error instanceof ApiError) || error.status > 0 && error.status < 500) setDefinition(null);
        setFailed(true);
      }
    }).finally(() => {
      if (!c.signal.aborted) setRefreshing(false);
    });
    return () => c.abort();
  }, [api, entity, retry, active, workspaceRevision]);
  const failure = failed && <>
    {!definition && <DataFields><div><dt>자료 식별자</dt><dd>{entity.identity_label}</dd></div></DataFields>}
    <Notice kind="error">속성 정의를 불러오지 못했습니다.{definition && " 마지막으로 읽은 내용을 표시합니다."}</Notice>
    <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>속성 정의 다시 조회</Button>
  </>;
  if (!definition) return failure || <p role="status">속성 정의를 불러오는 중…</p>;
  return (
    <>
      <DataFields aria-busy={refreshing || undefined}>
        {schemaPresentation(definition).order.filter((key) =>
          !activeOnly || !definition.schema.properties[key].deprecated
        ).map((key) => (
          <div
            key={key}
            data-full-width={longPropertyText(definition.schema.properties[key], entity.properties[key]) || undefined}
          >
            <dt>
              {definition.schema.properties[key].title ?? key}
              {definition.schema["x-identity-property"] === key
                ? " · 자료 식별자"
                : schemaPresentation(definition).archived.includes(key)
                ? " · 보관"
                : definition.schema.properties[key].readOnly
                ? " · 읽기 전용"
                : ""}
            </dt>
            <dd className="whitespace-pre-wrap">
              {displayedProperty(
                definition.schema.properties[key],
                entity.properties[key],
                schemaPresentation(definition).option_labels[key],
                definition.identifier_kinds,
              )}
            </dd>
          </div>
        ))}
      </DataFields>
      {failure}
    </>
  );
}
