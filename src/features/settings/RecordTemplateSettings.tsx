import { BodyAction } from "../../components/BodyAction.tsx";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { writeErrorMessage } from "../../lib/write-attempt.ts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { api, ApiError } from "../../lib/api.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { createRecordTemplatesDraft, unavailableTemplateTags } from "./business-settings-drafts.ts";

import type { MaterialTemplateResource } from "./material-template-drafts.ts";

const recordTemplatesDraft = createRecordTemplatesDraft(api);

export function RecordTemplateSettings(
  props: {
    onStateChange?: (state: { dirty: boolean; busy: boolean; uncertain?: boolean; error?: boolean }) => void;
    materialResource?: MaterialTemplateResource;
    materialTypeId?: string;
    publishedVersion?: number;
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
  const { draft, dirty, busy, conflict, uncertain, latestReady } = editor;
  const saved = editor.saved?.settings;
  const setDraft = editor.resource.edit;
  const [model, setModel] = useState<TemplateModel>(
    materialResource ? "entity" : "task",
  );
  const { types, error: typeError, retry: retryTypes } = useEntityTypes();
  const typeId = materialTypeId ?? "";
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
  }, [typeId, publishedVersion]);
  const [action, setAction] = useState<TemplateAction>("create");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const missing = unavailableTemplateTags(editor.saved, draft);
  const text = useRef<HTMLTextAreaElement>(null);
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
    setFields({});
  };
  const parse = recordTemplates.safeParse(draft);
  const currentError = parse.success ? null : parse.error.issues.find((issue) => issue.path.join(".").startsWith(path))
    ?.message;
  const title = materialResource ? "기록 자동 완성" : "변경 기록 기본값";
  return (
    <section className={materialResource ? "material-record-template" : "settings-section"} aria-label={title}>
      {!materialResource && <h2 className="settings-section-title">{title}</h2>}
      {!saved && (
        <>
          <p role={message ? "alert" : "status"}>
            {message || "설정을 읽는 중…"}
          </p>
          {message && (
            <BodyAction icon="reset" type="button" disabled={busy} onClick={() => void read()}>
              다시 시도
            </BodyAction>
          )}
        </>
      )}
      {saved && (
        <form
          className="form"
          aria-label={title}
          aria-busy={busy}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || conflict || !dirty) return;
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
              setMessage("기록 기본값을 저장했습니다.");
              setFields({});
            }
          }}
        >
          {missing.length > 0 && (
            <Notice kind="error">
              삭제된 기본 기록 태그 {missing.length}개를 정리해야 합니다. {materialResource &&
                "정리는 현재 설정 범위에만 적용합니다. 다른 종류나 모델의 오류는 해당 설정에서 정리하세요."}{" "}
              <BodyAction
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraft((current) =>
                    mapRecordTemplateTags(current, (ids) => ids.filter((id) => !missing.includes(id)))
                  );
                }}
              >
                삭제된 태그 정리
              </BodyAction>
            </Notice>
          )}
          <fieldset
            disabled={busy || uncertain}
            className="form plain-fieldset"
          >
            <div className="field-row">
              {!materialResource && (
                <Field label="모델">
                  {(props) => (
                    <select
                      {...props}
                      className="input"
                      value={model}
                      onChange={(event) => {
                        const next = event.target.value as TemplateModel;
                        setModel(next);
                        if (!modelActions(next).includes(action)) {
                          setAction("create");
                        }
                      }}
                    >
                      {TEMPLATE_MODELS.filter((key) => key !== "entity").map((key) => (
                        <option key={key} value={key}>
                          {templateModelNames[key]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field label="액션">
                {(props) => (
                  <select
                    {...props}
                    className="input"
                    value={action}
                    onChange={(event) => setAction(event.target.value as TemplateAction)}
                  >
                    {modelActions(model).map((key) => (
                      <option key={key} value={key}>
                        {templateActionNames[key]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            {model === "entity" && (
              <>
                {typeError && !materialResource && (
                  <Notice kind="error">
                    자료 종류를 읽지 못했습니다.{" "}
                    <BodyAction icon="reset" type="button" onClick={retryTypes}>
                      다시 시도
                    </BodyAction>
                  </Notice>
                )}
                {typeId && !schema && !schemaError && <p role="status">속성 정의를 읽는 중…</p>}
                {schemaError && (
                  <Notice kind="error">
                    속성 정의를 읽지 못했습니다. 자료 종류를 다시 선택하세요.
                  </Notice>
                )}
              </>
            )}
            <Field label="변수 삽입">
              {(props) => (
                <select
                  {...props}
                  className="input"
                  value=""
                  onChange={(event) => {
                    const variable = `$${event.target.value}$`;
                    const start = text.current?.selectionStart ??
                        value.memo.length,
                      end = text.current?.selectionEnd ?? start;
                    setValue({
                      memo: value.memo.slice(0, start) + variable +
                        value.memo.slice(end),
                    });
                    text.current?.focus();
                  }}
                >
                  <option value="" disabled>변수를 선택하세요</option>
                  {templateVariables(
                    model,
                    action,
                    model === "entity" && schema
                      ? schema.display.order.filter((key) => !schema.display.archived.includes(key))
                      : [],
                  ).map((variable) => {
                    const key = variable.split(".").at(-1)!;
                    return (
                      <option key={variable} value={variable}>
                        {schema?.schema.properties[key]
                          ? `${schema.schema.properties[key].title ?? key} · ${
                            variable.includes(".이전.") ? "이전" : "이후"
                          } (${key})`
                          : variable.replaceAll("엔터티", "자료")}
                      </option>
                    );
                  })}
                </select>
              )}
            </Field>
            <Field
              label="메모 템플릿"
              help="비워두면 기본 문구를 사용합니다. 달러 기호 자체는 $$로 입력하세요."
              error={fields[`${path}.memo`] ?? currentError ?? undefined}
            >
              {(props) => (
                <textarea
                  {...props}
                  ref={text}
                  className="input"
                  rows={3}
                  readOnly={uncertain}
                  value={value.memo}
                  onChange={(event) =>
                    setValue({ memo: model === "entity" && !event.target.value.trim() ? null : event.target.value })}
                />
              )}
            </Field>
            {model === "entity" && (
              <div className="record-template-defaults">
                <span className="secondary">{usingDefault ? "기본 문구 사용 중" : "이 종류의 문구 사용 중"}</span>
                {!usingDefault && (
                  <BodyAction icon="reset" onClick={() => setValue({ memo: null })}>
                    기본 문구로 되돌리기
                  </BodyAction>
                )}
              </div>
            )}

            <TagPicker
              label="기본 기록 태그"
              scope="record"
              value={value.tag_ids}
              onChange={(tag_ids) => setValue({ tag_ids })}
            />
            {Object.entries(fields).filter(([key]) => key !== `${path}.memo`)
              .map(([key, error]) => (
                <p className="error-text" key={key}>
                  {key.split(".")[0] === "entity" ? "자료" : templateModelNames[key.split(".")[0] as TemplateModel] ??
                    "설정"} {templateActionNames[key.split(".")[1] as TemplateAction] ??
                    ""}: {error}{" "}
                  <BodyAction
                    icon="view"
                    type="button"
                    disabled={!!materialResource}
                    onClick={() => {
                      const [nextModel, nextAction] = key.split(
                        ".",
                      );
                      if (
                        TEMPLATE_MODELS.includes(nextModel as TemplateModel)
                      ) {
                        setModel(nextModel as TemplateModel);
                        setAction(nextAction as TemplateAction);
                      }
                    }}
                  >
                    오류 항목 보기
                  </BodyAction>
                </p>
              ))}
          </fieldset>
          <p role="status">{message}</p>
          {conflict && (
            <BodyAction icon="reset" type="button" onClick={() => void read()}>
              최신값 확인
            </BodyAction>
          )}
          <div className="settings-section-footer">
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={busy || uncertain || (conflict ? !latestReady : !dirty)}
                onClick={() => {
                  editor.resource.reset();
                  setFields({});
                  setMessage("");
                }}
              >
                {conflict ? "최신값으로 다시 편집" : "변경 취소"}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !dirty || conflict}
              >
                {busy ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : "기록 기본값 저장"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
