import { useState } from "react";
import { type PropertyDraft, PropertyFields } from "../../src/features/entity/property-fields.tsx";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, useLocation } from "react-router";
import { SchemaEditor } from "../../src/features/settings/SchemaEditor.tsx";
import { useSchemaChangeEditor } from "../../src/features/settings/schema-change-editor.ts";
import { type EntityType, initialEntityDefinition } from "../../supabase/functions/_shared/contracts/entity-type.ts";
import "../../src/styles/app.css";
const type: EntityType = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "재료",
  icon_id: "leaf",
  archived: false,
  schema_version: 1,
  next_property_number: 2,
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
  definition.schema.properties.prop_1.title = "재료명";
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 20, type: "number", title: "수량" },
    prop_3: { "x-order": 30, type: "string", title: "단위", oneOf: [{ const: "kg" }, { const: "g" }] },
  });

  definition.schema.properties["prop_2"]["x-show-in-list"] = true;
  definition.schema.properties["prop_3"]["x-show-in-list"] = true;
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
  });
  const fields = {
    ...definition,
    schema: {
      ...definition.schema,
      properties: {
        ...definition.schema.properties,
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
  const location = useLocation();
  const [disabled, setDisabled] = useState(false);
  const editor = useSchemaChangeEditor({
    type,
    definition,
    disabled,
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
      <button onClick={() => setDisabled(!disabled)}>상위 차단 전환</button>
      <button onClick={() => editor.migrationStateChanged({ busy: true, uncertain: false, error: false })}>
        변환 접수 대기
      </button>
      <button onClick={() => editor.migrationStateChanged({ busy: false, uncertain: true, error: false })}>
        변환 접수 결과 불명
      </button>
      <button onClick={() => editor.migrationStateChanged({ busy: false, uncertain: false, error: false })}>
        변환 접수 종료
      </button>
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
  <BrowserRouter>
    <nav aria-label="Fixture navigation">
      <Link to="?change_id=a">변경안 A</Link>
      <Link to="?change_id=b">변경안 B</Link>
    </nav>
    {new URLSearchParams(location.search).has("action-probe")
      ? <ReviewActionsFixture />
      : new URLSearchParams(location.search).has("empty-inputs")
      ? <EmptyInputsFixture />
      : (
        <div className="panel settings">
          <SchemaEditor type={type} definition={definition} onState={onState} onApplied={onApplied} />
        </div>
      )}
  </BrowserRouter>,
);
