import { schemaPresentation } from "../../lib/schema-document.ts";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type { EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { api } from "../../lib/api.ts";
import { displayedProperty } from "./property-fields.tsx";
import { Notice } from "../../components/Field.tsx";
export function EntityProperties(
  { entity, identity, onReadyChange }: {
    entity: EntityValues;
    identity?: ReactNode;
    onReadyChange?: (ready: boolean) => void;
  },
) {
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
        <button className="btn" onClick={() => setRetry((n) => n + 1)}>속성 정의 다시 조회</button>
        {identity && <dl className="props key-value-grid">{identity}</dl>}
      </>
    );
  }
  if (!definition) return <p role="status">속성 정의를 불러오는 중…</p>;
  return (
    <dl className="props key-value-grid">
      {[
        schemaPresentation(definition).representative,
        ...schemaPresentation(definition).order.filter((key) => key !== schemaPresentation(definition).representative),
      ].map((key, index) => (
        <Fragment key={key}>
          <div className={index === 0 ? "key-value-full" : undefined}>
            <dt>
              {definition.schema.properties[key].title ?? key}
              {schemaPresentation(definition).archived.includes(key)
                ? " · 보관"
                : definition.schema.properties[key].readOnly
                ? " · 읽기 전용"
                : ""}
            </dt>
            <dd className={index === 0 ? "detail-title" : undefined}>
              {displayedProperty(
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
