import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import type { EntitySchemaVersion } from "@contracts/entity-type.ts";
import { SchemaDefinitionRead } from "./SchemaDefinitionRead.tsx";
import { schemaDiffLabel, schemaDiffValueLabel, schemaEntityLabel } from "./schema-labels.ts";

export function SchemaChangeDiff(
  { change, definition }: {
    change: EntitySchemaChange;
    definition: EntitySchemaVersion;
  },
) {
  const source = definition.schema_version === change.source_schema_version ? definition : {
    ...definition,
    display: { ...definition.display, option_labels: {} },
  };
  return (
    <dl className="schema-change-list">
      {change.diff.map((d, i) => (
        <div key={i}>
          <dt>{schemaDiffLabel(d.path, change.target, definition)}</dt>
          <dd>
            {d.before_present ? schemaDiffValueLabel(d.path, d.before, source) : "설정 안 함"}
            {" → "}
            {d.after_present ? schemaDiffValueLabel(d.path, d.after, change.target) : "설정 안 함"}
            {d.kind === "migration_required" && <span className="secondary">· 값 변환 필요</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
/** A job visit reads its proposal without adopting it as the user's input draft. */
export function SchemaChangeRead(
  { change, definition }: {
    change: EntitySchemaChange;
    definition: EntitySchemaVersion;
  },
) {
  return (
    <section className="schema-summary" aria-label="변환 작업의 변경 내용">
      <SchemaDefinitionRead definition={change.target} />
      <h3 className="section-title">변경 결과</h3>
      <p>버전 {change.source_schema_version} → {change.source_schema_version + 1}</p>
      <SchemaChangeDiff change={change} definition={definition} />
      {change.analysis && (
        <details>
          <summary>검토 결과</summary>
          <p>확인한 자료 {change.analysis.processed}/{change.analysis.total}개 · 문제 {change.analysis.failed}개</p>
          <p>
            변경 {change.analysis.changed}개 · 무변경 {change.analysis.unchanged}개 · 값 제거{" "}
            {change.analysis.removed}개 · 값 보완 {change.analysis.replacements}개
          </p>
          {change.analysis.failure_reason && <p className="error-text">{change.analysis.failure_reason}</p>}
          {change.analysis.errors.map((result) => (
            <div key={result.entity_id}>
              <strong>{schemaEntityLabel(result.entity_id)}</strong>
              <ul>
                {result.fields.map((field, i) => (
                  <li key={i}>{schemaDiffLabel(field.path, change.target, definition)}: {field.message}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
