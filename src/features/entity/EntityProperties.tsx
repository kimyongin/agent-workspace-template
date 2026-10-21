import { useApi } from "../../lib/api-context.tsx";
import { DataFields } from "../../components/DataFields.tsx";
import { Button } from "../../components/ui/button.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { useEffect, useLayoutEffect, useState } from "react";
import type { EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";

import { displayedProperty } from "./property-fields.tsx";
import { Notice } from "../../components/Field.tsx";
export function EntityProperties(
  { entity, onReadyChange, activeOnly = false }: {
    entity: EntityValues;
    activeOnly?: boolean;
    onReadyChange?: (ready: boolean) => void;
  },
) {
  const api = useApi();
  const [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const key = `${entity.entity_type_id}:${entity.current_schema_version}:${retry}`;
  const [readKey, setReadKey] = useState(key);
  if (readKey !== key) {
    setReadKey(key);
    setDefinition(null);
    setFailed(false);
  }
  useLayoutEffect(() => onReadyChange?.(!!definition || failed), [definition, failed, onReadyChange]);
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
        <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>속성 정의 다시 조회</Button>
      </>
    );
  }
  if (!definition) return <p role="status">속성 정의를 불러오는 중…</p>;
  return (
    <DataFields>
      {schemaPresentation(definition).order.filter((key) =>
        !activeOnly || !definition.schema.properties[key].deprecated
      ).map((key) => (
        <div key={key}>
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
          <dd>
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
  );
}
