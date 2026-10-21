import { useRef, useState } from "react";
import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import {
  effectiveEntityTitleTemplate,
  entityTitleTemplateIssues,
  renderEntityTitle,
} from "@contracts/entity-title-template.ts";
import { entitySchemaPresentation } from "@contracts/entity-type.ts";
import { Field } from "../../components/Field.tsx";
import { DataFields } from "../../components/DataFields.tsx";
import { FieldGroup } from "../../components/ui/field.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../../components/ui/combobox.tsx";
import { TemplateMemoEditor, type TemplateMemoHandle } from "./TemplateMemoEditor.tsx";

/** The same schema draft and save action own title and property edits. */
export function SchemaTitleTemplateSetting({ draft, saved, disabled, readOnly, onChange }: {
  draft: SchemaDefinition;
  saved: SchemaDefinition;
  disabled: boolean;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const input = useRef<TemplateMemoHandle>(null), [query, setQuery] = useState("");
  const keys = entitySchemaPresentation(draft.schema).order.filter((key) => !draft.schema.properties[key].deprecated);
  const variables = keys.map((key) => ({ value: key, label: draft.schema.properties[key].title || key }));
  const value = effectiveEntityTitleTemplate(draft.schema), issues = entityTitleTemplateIssues(value, draft.schema);
  const example = Object.fromEntries(keys.map((key) => {
    const field = draft.schema.properties[key];
    const type = Array.isArray(field.type) ? field.type.find((value) => value !== "null") : field.type;
    return [
      key,
      field.default ?? field.examples?.find((value) => value !== null) ?? field.oneOf?.[0]?.const ??
        (field.format === "date"
          ? "2026-01-01"
          : type === "boolean"
          ? false
          : type === "number" || type === "integer"
          ? 0
          : field.title || key),
    ];
  }));
  return (
    <FieldGroup>
      {!readOnly && (
        <Field label="제목에 넣을 속성">
          {(props) => (
            <Combobox<(typeof variables)[number]>
              items={variables}
              value={null}
              inputValue={query}
              onInputValueChange={setQuery}
              itemToStringLabel={(variable) => variable.label}
              onValueChange={(variable) => {
                if (variable) input.current?.insert(variable.value);
                setQuery("");
              }}
              disabled={disabled}
            >
              <ComboboxInput {...props} placeholder="속성을 선택하세요" />
              <ComboboxContent finalFocus={false}>
                <ComboboxEmpty>일치하는 속성이 없습니다.</ComboboxEmpty>
                <ComboboxList>
                  {(variable) => <ComboboxItem key={variable.value} value={variable}>{variable.label}</ComboboxItem>}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        </Field>
      )}
      <Field
        label="제목 템플릿"
        changed={value !== effectiveEntityTitleTemplate(saved.schema)}
        help="속성과 일반 문자를 조합합니다. 달러 기호 자체는 $$로 입력하세요."
        error={issues.length ? issues.map((issue) => issue.reason).join(" · ") : undefined}
      >
        {(props) => (
          <TemplateMemoEditor
            {...props}
            label="제목 템플릿"
            compact
            editorRef={input}
            value={value}
            variables={variables}
            disabled={disabled}
            readOnly={readOnly}
            onChange={onChange}
          />
        )}
      </Field>
      {!issues.length && (
        <>
          <DataFields>
            <div>
              <dt>예시 제목</dt>
              <dd>{renderEntityTitle(draft.schema, example, "자료 번호")}</dd>
            </div>
          </DataFields>
          <p className="text-sm text-muted-foreground">실제 자료가 아닌 입력 항목의 예시입니다.</p>
        </>
      )}
    </FieldGroup>
  );
}
