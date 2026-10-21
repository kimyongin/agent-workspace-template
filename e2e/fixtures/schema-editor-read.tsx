import { FixtureWorkspace } from "./workspace-scope.tsx";
import { useState } from "react";
import { type PropertyDraft, PropertyFields } from "../../src/features/entity/property-fields.tsx";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router";
import { SchemaEditor } from "../../src/features/settings/SchemaEditor.tsx";
import { useSchemaChangeEditor } from "../../src/features/settings/schema-change-editor.ts";
import { type EntityType, initialEntityDefinition } from "../../supabase/functions/_shared/contracts/entity-type.ts";
import type { EntitySchemaMigration } from "../../supabase/functions/_shared/contracts/entity-schema-migration.ts";
import "../../src/styles/app.css";
const noJobs: EntitySchemaMigration[] = [];
const type: EntityType = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "재료",
  icon_id: "leaf",
  archived: false,
  schema_version: 1,
  next_property_number: 3,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
};
const definition = {
  ...initialEntityDefinition("이름", { id: type.id, title: type.label, icon: type.icon_id }),
  type_id: type.id,
  schema_version: 1,
  created_at: type.created_at,
};
if (new URLSearchParams(location.search).has("display-example")) {
  definition.schema.properties.prop_4 = { ...definition.schema.properties.prop_2, "x-order": 40 };
  definition.schema["x-identity-property"] = "prop_4";
  definition.schema.required = ["prop_1", "prop_4"];
  type.next_property_number = 5;
  definition.schema.properties.prop_1.title = "재료명";
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 20, type: "number", title: "수량" },
    prop_3: { "x-order": 30, type: "string", title: "단위", oneOf: [{ const: "kg" }, { const: "g" }] },
  });



  definition.schema.properties.prop_3.oneOf = Object.entries({ kg: "킬로그램", g: "그램" }).map(([value, title]) => ({
    const: value,
    title,
  }));
}
function EmptyInputsFixture() {
  const [values, setValues] = useState<PropertyDraft>({
    prop_1: "자료",
    prop_2: "0",
    prop_3: false,
    prop_4: "a",
    prop_5: "이전 값",
    prop_6: "a",
    prop_7: "00000000-0000-4000-8000-000000000001:existing",
  });
  const fields = {
    ...definition,
    schema: {
      ...definition.schema,
      "x-identity-property": "prop_7",
      required: ["prop_1", "prop_7"],
      properties: {
        ...definition.schema.properties,
        prop_7: { ...initialEntityDefinition("이름").schema.properties.prop_2, "x-order": 70 },
        prop_2: { "x-order": 20, type: ["number", "null"] as ("number" | "null")[], title: "숫자 입력" },
        prop_3: { "x-order": 30, type: ["boolean", "null"] as ("boolean" | "null")[], title: "참거짓 입력" },
        prop_4: {
          "x-order": 40,
          type: ["string", "null"] as ("string" | "null")[],
          oneOf: [{ const: "a" }, { const: null }],
          title: "선택 입력",
        },
        prop_5: { "x-order": 50, type: "string" as const, title: "이전 텍스트" },
        prop_6: {
          "x-order": 60,
          type: ["string", "null"] as ("string" | "null")[],
          oneOf: [{ const: "a" }],
          title: "이전 선택",
        },
      },
    },
  };
  return (
    <>
      <PropertyFields definition={fields} values={values} onChange={setValues} errors={{}} />
      <output aria-label="입력 결과">{JSON.stringify(values)}</output>
    </>
  );
}
function ReviewActionsFixture() {
  const location = useLocation(), navigate = useNavigate();
  const [disabled, setDisabled] = useState(false);
  const editor = useSchemaChangeEditor({
    type,
    definition,
    disabled,
    jobs: noJobs,
    onNavigate: navigate,
    selectionSearch: location.search,
    onState,
    onApplied,
    onFieldKeysChanged: () => {},
    onInvalidField: () => {},
    onReviewed: () => {},
  });
  const action = editor.actions.history;
  return (
    <>
      <output aria-label="현재 행동">{action?.kind ?? "none"}</output>
      <output aria-label="행동 차단">{String(action?.disabled ?? true)}</output>
      <output aria-label="접수 안내">{action?.label ?? ""}</output>
      <output aria-label="입력 차단">{String(editor.view.inputsDisabled)}</output>
      <output aria-label="검토 차단">{String(editor.actions.review.disabled)}</output>
      <button onClick={() => setDisabled(!disabled)}>상위 차단 전환</button>
      <button onClick={() => void editor.refreshPlan()}>상태 조회</button>
      {/* Invoke the public command without a DOM disabled guard to verify its own policy. */}
      <button onClick={() => void action?.run?.()}>행동 실행 요청</button>
      <button onClick={() => void editor.actions.review.run()}>속성 검토 요청</button>
    </>
  );
}
const onState = () => {};
const onApplied = async () => "";
createRoot(document.getElementById("root")!).render(
  <FixtureWorkspace actorId="fixture-actor"><BrowserRouter>
    <nav aria-label="Fixture navigation">
      <Link to="?change_id=a">변경안 A</Link>
      <Link to="?change_id=b">변경안 B</Link>
    </nav>
    {new URLSearchParams(location.search).has("action-probe")
      ? <ReviewActionsFixture />
      : new URLSearchParams(location.search).has("empty-inputs")
      ? <EmptyInputsFixture />
      : (
        <div>
          <SchemaEditor type={type} definition={definition} onState={onState} onApplied={onApplied} />
        </div>
      )}
  </BrowserRouter></FixtureWorkspace>,
);
