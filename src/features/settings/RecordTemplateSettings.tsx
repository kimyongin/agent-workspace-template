import { useApi } from "../../lib/api-context.tsx";
import { RotateCcwIcon, EyeIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import { FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Button } from "../../components/ui/button.tsx";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { TemplateMemoEditor, type TemplateMemoHandle } from "./TemplateMemoEditor.tsx";
import { changedTemplateActions, templateFieldTarget } from "./record-template-actions.ts";

import { useEntityTypes } from "../entity/useEntityTypes.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { writeErrorMessage } from "../../lib/write-attempt.ts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_RECORD_MEMO_TEMPLATES,
  effectiveRecordTemplate,
  mapRecordTemplateTags,
  modelActions,
  recordTemplates,
  TEMPLATE_MODELS,
  type TemplateAction,
  templateActionNames,
  type TemplateModel,
  templateModelNames,
  templateVariables,
} from "@contracts/record-template.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { TagPicker } from "../tags/TagPicker.tsx";
import { ApiError } from "../../lib/api.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { createRecordTemplatesDraft, unavailableTemplateTags } from "./business-settings-drafts.ts";

import type { MaterialTemplateResource } from "./material-template-drafts.ts";



export function RecordTemplateSettings(
  props: {
    onStateChange?: (state: { dirty: boolean; busy: boolean; uncertain?: boolean; error?: boolean }) => void;
    materialResource?: MaterialTemplateResource;
    materialTypeId?: string;
    publishedVersion?: number;
    selectedModel?: TemplateModel;
  },
) {
  return props.materialResource
    ? (
      <MaterialRecordTemplateSettings
        {...props}
        materialResource={props.materialResource}
      />
    )
    : <GeneralRecordTemplateSettings {...props} />;
}
function GeneralRecordTemplateSettings(
  props: Parameters<typeof RecordTemplateSettings>[0],
) {
  const api = useApi();
  const recordTemplatesDraft = useMemo(() => createRecordTemplatesDraft(api), [api]);
  const editor = useSettingsDraft(recordTemplatesDraft, props.onStateChange);
  return <RecordTemplateForm {...props} editor={editor} />;
}
function MaterialRecordTemplateSettings(
  props: Parameters<typeof RecordTemplateSettings>[0] & {
    materialResource: MaterialTemplateResource;
  },
) {
  const state = useSyncExternalStore(
    props.materialResource.subscribe,
    props.materialResource.snapshot,
  );
  useEffect(() => {
    void props.materialResource.read();
  }, [props.materialResource]);
  useEffect(() => {
    props.onStateChange?.({
      dirty: state.dirty || state.uncertain,
      uncertain: state.uncertain,
      error: !!state.error,
      busy: state.busy && state.operation === "save",
    });
  }, [
    state.dirty,
    state.uncertain,
    state.busy,
    state.operation,
    state.error,
    props.onStateChange,
  ]);
  return (
    <RecordTemplateForm
      {...props}
      editor={{ ...state, resource: props.materialResource }}
    />
  );
}
function RecordTemplateForm({
  editor,
  materialResource,
  materialTypeId,
  publishedVersion,
  selectedModel,
}: Parameters<typeof RecordTemplateSettings>[0] & {
  editor: ReturnType<
    typeof useSettingsDraft<
      import("@contracts/record-template.ts").RecordTemplates,
      Awaited<
        ReturnType<ReturnType<typeof createRecordTemplatesDraft>["read"]>
      >
    >
  >;
}) {
  const api = useApi();
  const [variableQuery, setVariableQuery] = useState("");
  const { draft, dirty, busy, conflict, uncertain, latestReady } = editor;
  const saved = editor.saved?.settings;
  const setDraft = editor.resource.edit;
  const [model, setModel] = useState<TemplateModel>(
    selectedModel ?? (materialResource ? "entity" : "task"),
  );
  const { types, error: typeError, retry: retryTypes } = useEntityTypes();
  const typeId = materialTypeId ?? "";
  const [schemaAttempt, setSchemaAttempt] = useState(0);
  const [schema, setSchema] = useState<EntitySchemaResult | null>(null),
    [schemaError, setSchemaError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSchema(null);
    setSchemaError(false);
    if (typeId) {
      void api<EntitySchemaResult>(
        "GET",
        `/entity-types/${typeId}/schema`,
        undefined,
        controller.signal,
      ).then(
        (value) => {
          if (!controller.signal.aborted) setSchema(value);
        },
      ).catch(() => {
        if (!controller.signal.aborted) setSchemaError(true);
      });
    }
    return () => controller.abort();
  }, [typeId, publishedVersion, schemaAttempt]);
  const [action, setAction] = useState<TemplateAction>("create");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const missing = unavailableTemplateTags(editor.saved, draft);
  const text = useRef<TemplateMemoHandle>(null);
  const read = async () => {
    const refreshing = !!saved;
    setMessage("");
    if (await editor.resource.read()) {
      setMessage(
        refreshing
          ? "최신 설정을 읽었습니다. 초안을 보존했습니다. 최신값으로 다시 편집하면 읽어온 설정을 적용합니다."
          : "",
      );
    }
  };
  useEffect(() => {
    if (editor.error) {
      setMessage(
        conflict && editor.operation === "save"
          ? "같은 설정에 다른 변경이 저장되어 있습니다. 초안을 보존했습니다. 최신값을 확인한 뒤 다시 편집하세요."
          : writeErrorMessage(editor.error),
      );
      if (editor.error instanceof ApiError) {
        setFields(
          Object.fromEntries(
            editor.error.fields.map((
              field,
            ) => [
              field.path.replace(/^(?:value|record_templates)\./, ""),
              field.message,
            ]),
          ),
        );
      }
    }
  }, [editor.error]);
  const path = model === "entity" && typeId ? `entity_types.${typeId}.${action}` : `${model}.${action}`;
  const stored = model === "entity" ? draft.entity_types?.[typeId]?.[action] : draft[model]?.[action];
  const usingDefault = model === "entity" && stored?.memo == null;
  const value = effectiveRecordTemplate(
    draft,
    model,
    action,
    typeId || undefined,
  );
  const setValue = (patch: Partial<{ memo: string | null; tag_ids: string[] }>) => {
    setDraft((current) => {
      if (model === "entity") {
        if (!typeId) return current;
        return {
          ...current,
          entity_types: {
            ...current.entity_types,
            [typeId]: {
              ...current.entity_types?.[typeId],
              [action]: {
                ...(current.entity_types?.[typeId]?.[action] ?? { memo: null, tag_ids: [] }),
                ...patch,
              },
            },
          },
        };
      }
      return {
        ...current,
        [model]: { ...current[model], [action]: { ...value, ...patch, memo: patch.memo ?? value.memo } },
      };
    });
    setMessage("");
    setFields((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== path && !key.startsWith(`${path}.`)))
    );
  };
  const parse = recordTemplates.safeParse(draft);
  const currentError = parse.success ? null : parse.error.issues.find((issue) => issue.path.join(".").startsWith(path))
    ?.message;
  const changes = changedTemplateActions(draft, saved?.settings.record_templates ?? {}, model, typeId);
  const errors = {
    ...(!parse.success
      ? Object.fromEntries(parse.error.issues.map((issue) => [issue.path.join("."), issue.message]))
      : {}),
    ...fields,
  };
  const actionHasError = (key: TemplateAction) =>
    Object.keys(errors).some((path) => {
      const target = templateFieldTarget(path);
      return target?.model === model && (model !== "entity" || target.typeId === typeId) && target.action === key;
    });
  const variables = templateVariables(
    model,
    action,
    model === "entity" && schema
      ? schemaPresentation(schema).order.filter((key) => !schemaPresentation(schema).archived.includes(key))
      : [],
  ).map((variable) => {
    const key = variable.split(".").at(-1)!;
    return {
      value: variable,
      label: schema?.schema.properties[key]
        ? `${schema.schema.properties[key].title || "이름 없는 항목"} · ${
          variable.includes(".이전.") ? "이전" : "이후"
        }`
        : variable.replaceAll("엔터티", "자료"),
    };
  });
  const labelCounts = new Map<string, number>();
  for (const variable of variables) labelCounts.set(variable.label, (labelCounts.get(variable.label) ?? 0) + 1);
  const seenLabels = new Map<string, number>();
  for (const variable of variables) {
    const label = variable.label;
    if ((labelCounts.get(label) ?? 0) > 1) {
      const number = (seenLabels.get(label) ?? 0) + 1;
      seenLabels.set(label, number);
      variable.label = `${label} (${number})`;
    }
  }
  const schemaUnavailable = model === "entity" && !!typeId && !schema;
  const title = "기록 자동 완성";
  return (
    <section className={materialResource ? "min-w-0" : "flex min-w-0 flex-col gap-4"} aria-label={title}>
      {!materialResource && !selectedModel && <h2 className="text-base font-semibold">{title}</h2>}
      {!saved && (
        <>
          <Alert role={message ? "alert" : "status"}><AlertDescription>
            {message || "설정을 읽는 중…"}
          </AlertDescription></Alert>
          {message && (
            <Button variant="ghost"  type="button" disabled={busy} onClick={() => void read()}><RotateCcwIcon data-icon="inline-start" />
              다시 시도
            </Button>
          )}
        </>
      )}
      {saved && (
        <form
          className="flex min-w-0 flex-col gap-5"
          aria-label={title}
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || conflict || !dirty || schemaUnavailable) return;
            if (!parse.success) {
              setFields(
                Object.fromEntries(
                  parse.error.issues.map((
                    issue,
                  ) => [issue.path.join("."), issue.message]),
                ),
              );
              setMessage("템플릿 오류를 확인하세요.");
              return;
            }
            setMessage("");
            if (await editor.resource.save()) {
              window.dispatchEvent(new Event("workspace:record-settings-changed"));
              setMessage("기록 자동 완성을 저장했습니다.");
              setFields({});
            }
          }}
        >
          {missing.length > 0 && (
            <Notice kind="error">
              삭제된 기본 기록 태그 {missing.length}개를 정리해야 합니다. {materialResource &&
                "정리는 현재 설정 범위에만 적용합니다. 다른 종류나 모델의 오류는 해당 설정에서 정리하세요."}{" "}
              <Button variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft((current) =>
                    mapRecordTemplateTags(current, (ids) => ids.filter((id) => !missing.includes(id)))
                  );
                }}
              >
                삭제된 태그 정리
              </Button>
            </Notice>
          )}
          <FieldSet
            disabled={busy || uncertain}
            className="flex min-w-0 flex-col gap-5 border-0 p-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]"
          >
            <>
              {!materialResource && !selectedModel && (
                <Field label="대상">
                  {(props) => (
                    <Select value={model} onValueChange={(value) => {
                        const next = value as TemplateModel;
                        setModel(next);
                        if (!modelActions(next).includes(action)) {
                          setAction("create");
                        }
                      }} disabled={busy || uncertain}><SelectTrigger {...props}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                      {TEMPLATE_MODELS.filter((key) => key !== "entity").map((key) => (
                        <SelectItem key={key} value={key}>
                          {templateModelNames[key]}
                        </SelectItem>
                      ))}
                    </SelectGroup></SelectContent></Select>
                  )}
                </Field>
              )}
              <Field label="액션">
                {(props) => (
                  <Select value={action} onValueChange={(value) => setAction(value as TemplateAction)} disabled={busy || uncertain}><SelectTrigger {...props}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                    {modelActions(model).map((key) => (
                      <SelectItem key={key} value={key}>
                        {templateActionNames[key]}
                        {actionHasError(key) ? " · 오류" : changes.includes(key) ? " · 미저장" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup></SelectContent></Select>
                )}
              </Field>
            </>
            {model === "entity" && (
              <>
                {typeError && !materialResource && (
                  <Notice kind="error">
                    자료 종류를 읽지 못했습니다.{" "}
                    <Button variant="ghost"  type="button" onClick={retryTypes}><RotateCcwIcon data-icon="inline-start" />
                      다시 시도
                    </Button>
                  </Notice>
                )}
              </>
            )}
            <Field label="변수 삽입">
              {(props) => (
                <Combobox<(typeof variables)[number]> items={variables} value={null} inputValue={variableQuery} onInputValueChange={setVariableQuery} itemToStringLabel={variable => variable.label} onValueChange={variable => { if(variable) text.current?.insert(variable.value); setVariableQuery(""); }} disabled={schemaUnavailable || busy || uncertain}>
                  <ComboboxInput {...props} placeholder="변수를 선택하세요" /><ComboboxContent finalFocus={false}><ComboboxEmpty>일치하는 변수가 없습니다.</ComboboxEmpty><ComboboxList>{variable => <ComboboxItem key={variable.value} value={variable}>{variable.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
                </Combobox>
              )}
            </Field>
            <Field
              fullWidth
              label="메모 템플릿"
              help={schemaUnavailable
                ? undefined
                : "비워두면 기본 문구를 사용합니다. 달러 기호 자체는 $$로 입력하세요."}
              error={fields[`${path}.memo`] ?? currentError ?? undefined}
            >
              {(props) => (
                schemaUnavailable
                  ? schemaError
                    ? (
                      <Notice kind="error">
                        입력 항목 정의를 읽지 못했습니다.{" "}
                        <Button variant="ghost" type="button"

                          aria-label="입력 항목 정의 다시 조회"
                          onClick={() => setSchemaAttempt((value) => value + 1)}
                        ><RotateCcwIcon data-icon="inline-start" />
                          다시 시도
                        </Button>
                      </Notice>
                    )
                    : <Alert role="status"><AlertDescription>입력 항목 정의를 읽는 중…</AlertDescription></Alert>
                  : (
                    <TemplateMemoEditor
                      key={`${model}:${typeId}:${action}`}
                      {...props}
                      editorRef={text}
                      variables={variables}
                      disabled={busy}
                      readOnly={uncertain}
                      value={stored?.memo ?? value.memo}
                      onChange={(memo) => setValue({ memo: model === "entity" && !memo.trim() ? null : memo })}
                    />
                  )
              )}
            </Field>
            {model === "entity" && !usingDefault && !schemaUnavailable && (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <Button variant="ghost" type="button"  onClick={() => setValue({ memo: null })}><RotateCcwIcon data-icon="inline-start" />
                  기본 문구로 되돌리기
                </Button>
              </div>
            )}

            <div className="min-w-0 col-span-full">
              <TagPicker
                disabled={busy || uncertain}
                label="기본 기록 태그"
                scope="record"
                value={value.tag_ids}
                onChange={(tag_ids) => setValue({ tag_ids })}
              />
            </div>
            {Object.entries(errors).filter(([key]) => key !== `${path}.memo`).map(([key, error]) => {
              const target = templateFieldTarget(key);
              const canOpen = target &&
                (!materialResource || target.model === model && (model !== "entity" || target.typeId === typeId));
              return (
                <Alert variant="destructive" className="text-sm text-destructive" key={key} role="alert"><AlertDescription>
                  {target ? `${templateActionNames[target.action]}: ` : "설정: "}
                  {error} {canOpen && target.action !== action && (
                    <Button variant="ghost"

                      type="button"
                      onClick={() => {
                        setModel(target.model);
                        setAction(target.action);
                        requestAnimationFrame(() => text.current?.focus());
                      }}
                    ><EyeIcon data-icon="inline-start" />
                      오류 항목 보기
                    </Button>
                  )}
                </AlertDescription></Alert>
              );
            })}
          </FieldSet>
          <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>
          {conflict && (
            <Button variant="ghost"  type="button" onClick={() => void read()}><RotateCcwIcon data-icon="inline-start" />
              최신값 확인
            </Button>
          )}
          <div className="flex flex-col gap-3 pt-4">
            {changes.length > 0 && (
              <p className="text-sm text-muted-foreground" aria-label="저장할 변경">
                변경: {changes.map((key) => templateActionNames[key]).join(" · ")}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline"
                type="button"

                disabled={busy || uncertain || (conflict ? !latestReady : !dirty)}
                aria-label={conflict ? "최신값으로 다시 편집" : "변경 취소"}
                onClick={() => {
                  editor.resource.reset();
                  setFields({});
                  setMessage("");
                }}
              >
                {conflict ? "최신값으로 다시 편집" : "취소"}
              </Button>
              <Button variant="default"
                type="submit"

                disabled={busy || !dirty || conflict || schemaUnavailable}
                aria-label={busy ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : "기록 자동 완성 저장"}
              >
                {busy ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : "저장"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
