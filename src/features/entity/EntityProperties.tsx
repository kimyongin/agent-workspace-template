import { schemaPresentation } from "../../lib/schema-document.ts";
import { useEffect, useState } from "react";
import type { EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { api } from "../../lib/api.ts";
import { displayedProperty } from "./property-fields.tsx";
import { Notice } from "../../components/Field.tsx";
export function EntityProperties(
  { entity, omitRepresentative = false }: { entity: EntityValues; omitRepresentative?: boolean },
) {
  const [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
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
      </>
    );
  }
  if (!definition) return <p role="status">속성 정의를 불러오는 중…</p>;
  return (
    <dl className="props">
      {schemaPresentation(definition).order.filter((key) =>
        !omitRepresentative || key !== schemaPresentation(definition).representative
      ).map((
        key,
      ) => (
        <div key={key}>
          <dt>
            {definition.schema.properties[key].title ?? key}
            {schemaPresentation(definition).archived.includes(key) ? " · 보관" : ""}
          </dt>
          <dd>
            {displayedProperty(
              definition.schema.properties[key],
              entity.properties[key],
              schemaPresentation(definition).option_labels[key],
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
