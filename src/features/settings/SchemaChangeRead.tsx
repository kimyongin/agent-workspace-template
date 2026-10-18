import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

import { schemaPresentation } from "../../lib/schema-document.ts";
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
    schema: { ...definition.schema, properties: {} },
  };
  return (
<BusinessTable label="변경안 차이 목록" columns={["설정", "변경 전후"]} disclosureColumn={false}>
      {change.diff.map((d, i) => (
        <BusinessRow key={i}>
          <BusinessCell index={0}>{schemaDiffLabel(d.path, change.target, definition)}</BusinessCell>
          <BusinessCell index={1}>
            {d.before_present ? schemaDiffValueLabel(d.path, d.before, source) : "설정 안 함"}
            {" → "}
            {d.after_present ? schemaDiffValueLabel(d.path, d.after, change.target) : "설정 안 함"}
            {d.kind === "migration_required" && <span className="text-sm text-muted-foreground">· 값 변환 필요</span>}
          </BusinessCell>
        </BusinessRow>
      ))}
    </BusinessTable>
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
    <section className="min-w-0" aria-label="변환 작업의 변경 내용">
      <SchemaDefinitionRead definition={change.target} />
      <h3 className="text-base font-semibold">변경 결과</h3>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3">
        <div>
          <dt>버전</dt>
          <dd>{change.source_schema_version} → {change.source_schema_version + 1}</dd>
        </div>
      </dl>
      <SchemaChangeDiff change={change} definition={definition} />
      {change.analysis && (
        <Collapsible>
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto min-h-[max(2.75rem,44px)] w-full justify-start whitespace-normal text-left">검토 결과</Button></CollapsibleTrigger><CollapsibleContent forceMount className="min-w-0 pt-3 data-[state=closed]:hidden">
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3">
            <div>
              <dt>확인한 자료</dt>
              <dd>{change.analysis.processed}/{change.analysis.total}개</dd>
            </div>
            <div>
              <dt>문제</dt>
              <dd>{change.analysis.failed}개</dd>
            </div>
          </dl>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3">
            <div>
              <dt>변경</dt>
              <dd>{change.analysis.changed}개</dd>
            </div>
            <div>
              <dt>무변경</dt>
              <dd>{change.analysis.unchanged}개</dd>
            </div>
            <div>
              <dt>값 제거</dt>
              <dd>{change.analysis.removed}개</dd>
            </div>
            <div>
              <dt>값 보완</dt>
              <dd>{change.analysis.replacements}개</dd>
            </div>
          </dl>
          {change.analysis.failure_reason && <p className="text-sm text-destructive">{change.analysis.failure_reason}</p>}
          <SchemaAnalysisErrors change={change} definition={definition} />
        </CollapsibleContent></Collapsible>
      )}
    </section>
  );
}


/** Both current review and historical jobs show the same complete per-material problems. */
export function SchemaAnalysisErrors({ change, definition }: {
  change: EntitySchemaChange;
  definition: EntitySchemaVersion;
}) {
  if (!change.analysis?.errors.length) return null;
  return <BusinessTable label="자료별 검토 문제" columns={["자료", "검토 문제"]} disclosureColumn={false}>
    {change.analysis.errors.map(result => <BusinessRow key={result.entity_id}>
      <BusinessCell index={0}>{schemaEntityLabel(result.entity_id)}</BusinessCell>
      <BusinessCell index={1}>
        <ul role="list" className="flex min-w-0 flex-col gap-2 wrap-anywhere">
          {result.fields.map((field, index) => <li key={index}>
            {schemaDiffLabel(field.path, change.target, definition)}: {field.message}
          </li>)}
        </ul>
      </BusinessCell>
    </BusinessRow>)}
  </BusinessTable>;
}
