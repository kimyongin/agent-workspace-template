import { renderEntityTitle } from "@contracts/entity-title-template.ts";
import { DataFields, DataFieldGroup } from "@/components/DataFields";
import { ChangedValue } from "../../components/ChangedValue.tsx";
import type { ConfirmationValue } from "../../components/RecordConfirmation.tsx";
import { useEntityReadAccess, useEntityWriteAccess } from "./entity-access.ts";
import { useApi } from "../../lib/api-context.tsx";
import { FieldGroup } from "../../components/ui/field.tsx";
import { PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { Link } from "../../lib/workspace-router.tsx";
import { EntityTypePicker } from "./EntityTypePicker.tsx";
import { identifierValue } from "@contracts/entity-identifiers.ts";
import { ApiError } from "../../lib/api.ts";
import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import { type EntityCreate, entityCreate, type EntityDetail, type EntityRestore, type EntityUpdate, type EntityValues } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { useEntityTypes } from "./useEntityTypes.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Notice } from "../../components/Field.tsx";

import { fieldErrors } from "../../lib/format.ts";
import { ReadonlyTags } from "../tags/TagConnections.tsx";
import {
  fieldType,
  type PropertyDraft,
  propertyDraft,
  PropertyDraftError,
  PropertyFields,
  propertyValues,
  displayedProperty,
} from "./property-fields.tsx";
export type EntityFormSubmission =
  | { action: "create"; input: EntityCreate }
  | { action: "update"; id: string; input: EntityUpdate }
  | { action: "restore"; id: string; input: EntityRestore };
export function EntityForm({
  initial,
  initialTypeId,
  initialTypeLabel,
  fixedType = false,
  readonly = false,
  visible = true,
  context,
  submitLabel = "저장",
  details,
  relations,
  deletion,
  onClose,
  onRouteDiscard,
  onSave,
}: {
  initial?: EntityDetail;
  initialTypeId?: string;
  initialTypeLabel?: string;
  fixedType?: boolean;
  readonly?: boolean;
  visible?: boolean;
  context?: ReactNode;
  submitLabel?: string;
  details?: ReactNode;
  relations?: ReactNode;
  deletion?: DeletionOptions;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (value: EntityFormSubmission, requestKey: () => string) => Promise<void>;
}) {
  const api = useApi(), canWriteType = useEntityWriteAccess(), canReadType = useEntityReadAccess();
  const [typeId, setTypeId] = useState(initial?.entity_type_id ?? initialTypeId ?? ""),
    [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaError, setSchemaError] = useState(""),
    [pendingDefinition, setPendingDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaReading, setSchemaReading] = useState(false),
    [reviewKeys, setReviewKeys] = useState<string[]>([]),
    [nextType, setNextType] = useState<string | null>(null);
  const { types, error: catalogError, retry: retryCatalog } = useEntityTypes();
  const readable = visible && (!typeId || canReadType(typeId));
  const canWrite = readable && !readonly && canWriteType(typeId);
  const writableTypes = types?.filter((type) => !type.archived && canWriteType(type.id));
  const [archived, setArchived] = useState<EntityValues | null>(initial?.deleted_at ? initial : null),
    [identityMessage, setIdentityMessage] = useState("");
  const [properties, setProperties] = useState<PropertyDraft>(propertyDraft(initial?.properties ?? {})),
    [generations, setGenerations] = useState<Record<string, string>>({});
  const baseline = useRef({
    properties: propertyDraft(initial?.properties ?? {}),
    generations: {} as Record<string, string>,
    typeId: initial?.entity_type_id ?? initialTypeId ?? "",
  });
  const prepared = useRef<Record<string, unknown> | null>(null),
    initializedType = useRef<string | null>(null),
    lookup = useRef<AbortController | null>(null),
    definitionRead = useRef<AbortController | null>(null);
  useEffect(() => () => lookup.current?.abort(), [typeId]);
  useEffect(() => {
    const c = new AbortController();
    definitionRead.current?.abort();
    setPendingDefinition(null);
    setSchemaReading(false);
    setReviewKeys([]);
    setDefinition(null);
    setSchemaError("");
    if (typeId) {
      void api<EntitySchemaResult>("GET", `/entity-types/${typeId}/schema`, undefined, c.signal).then((value) => {
        if (c.signal.aborted) return;
        setDefinition(value);
        if (!initial && !archived && initializedType.current !== typeId) {
          initializedType.current = typeId;
          const defaults = Object.fromEntries(
            Object.entries(value.schema.properties).filter(([key, field]) =>
              field.default !== undefined && !field.readOnly && !field.deprecated
            ).map(([key, field]) => [key, field.default!]),
          );
          const draft = propertyDraft(defaults);
          const identity = value.schema["x-identity-property"];
          const defaultKind = identity && value.schema.properties[identity]?.["x-identifier"]?.default_kind_id;
          const generate = identity && defaultKind && value.identifier_kinds?.some(kind => kind.id === defaultKind && kind.active && kind.generation === "automatic")
            ? { [identity]: defaultKind } : {};
          setProperties(draft);
          setGenerations(generate);
          baseline.current.properties = draft;
          baseline.current.generations = generate;
        }
      }).catch(() => {
        if (!c.signal.aborted) {
          setSchemaError("속성 정의를 불러오지 못했습니다. 초안은 유지했습니다.");
        }
      });
    }
    return () => c.abort();
  }, [typeId]);
  const readDefinition = async () => {
    if (!typeId || schemaReading) return;
    const controller = new AbortController();
    definitionRead.current?.abort();
    definitionRead.current = controller;
    setSchemaReading(true);
    try {
      const latest = await api<EntitySchemaResult>(
        "GET",
        `/entity-types/${typeId}/schema`,
        undefined,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      setPendingDefinition(latest);
    } catch (error) {
      if (!controller.signal.aborted) {
        setSchemaError(error instanceof Error ? error.message : "현재 정의를 읽지 못했습니다. 초안은 유지했습니다.");
      }
    } finally {
      if (!controller.signal.aborted) setSchemaReading(false);
    }
  };
  const acceptDefinition = () => {
    if (!pendingDefinition) return;
    const kind = (field: EntitySchemaResult["schema"]["properties"][string] | undefined) =>
      field ? `${fieldType(field)}:${field.format ?? ""}:${fieldChoices(field) ? "selection" : ""}:${field["x-identifier"] ? "identifier" : ""}` : "missing";
    setReviewKeys(
      Object.keys(properties).filter((key) =>
        kind(definition?.schema.properties[key]) !== kind(pendingDefinition.schema.properties[key])
      ),
    );
    setDefinition(pendingDefinition);
    setSchemaError("");
    setPendingDefinition(null);
    prepared.current = null;
  };
  const activeType = types?.find((type) => type.id === typeId),
    label = activeType?.label ?? initial?.type.label ?? initialTypeLabel ?? "자료";
  const effectiveProperties = !initial && !archived && definition
    ? {
      ...properties,
      ...propertyDraft(Object.fromEntries(
        Object.entries(definition.schema.properties).filter(([, field]) =>
          field.readOnly && !field.deprecated && field.default !== undefined
        ).map(([key, field]) => [key, field.default!]),
      )),
    }
    : properties;
  const value = () => {
    if (!definition) throw new Error("자료 종류와 속성 정의를 확인하세요");
    const values = propertyValues(definition, properties);
    const writable = Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        !definition.schema.properties[key]?.deprecated && !definition.schema.properties[key]?.readOnly
      ),
    );
    return {
      entity_type_id: typeId,
      schema_version: definition.schema_version,
      properties: writable,
      ...(Object.keys(generations).length ? { generate_identifiers: generations } : {}),
    };
  };
  const checkExisting = async () => {
    if (initial || archived) return archived;
    const key = definition?.schema["x-identity-property"];
    if (!key) throw new Error("자료 식별자 항목을 확인하세요");
    if (generations[key]) return null;
    const identity = identifierValue.safeParse(properties[key]);
    if (!identity.success) throw new Error("자료 식별자의 종류와 원본 값을 입력하세요");
    lookup.current?.abort();
    const c = new AbortController();
    lookup.current = c;
    try {
      const query = new URLSearchParams({ entity_type_id: typeId, identifier: identity.data });
      const stored = await api<EntityValues | null>(
        "GET",
        `/entities/lookup?${query}`,
        undefined,
        c.signal,
      );
      c.signal.throwIfAborted();
      if (!stored) { setIdentityMessage("새로운 자료 식별자입니다."); return null; }
      if (!stored.deleted_at) throw new Error("같은 자료 식별자의 활성 자료가 있습니다.");
      if (stored.entity_type_id !== typeId) {
        throw new Error("삭제된 자료의 종류가 다릅니다. 원래 자료 종류에서 복원하세요.");
      }
      setArchived(stored);
      setProperties(propertyDraft(stored.properties));
      setGenerations({});
      setIdentityMessage("보관한 자료를 불러왔습니다. 속성과 연결을 확인한 뒤 복원을 저장하세요.");
      return stored;
    } catch (e) {
      c.signal.throwIfAborted();
      throw e;
    }
  };
  const submission = (): EntityFormSubmission => {
    const { entity_type_id, ...input } = value();
    if (archived) return { action: "restore", id: archived.id, input: {
      schema_version: input.schema_version, properties: input.properties, expected_version: archived.version,
    } };
    if (initial) return { action: "update", id: initial.id, input: { ...input, expected_version: initial.version } };
    return { action: "create", input: { entity_type_id, ...input } };
  };
  const dirty = typeId !== baseline.current.typeId || JSON.stringify(properties) !== JSON.stringify(baseline.current.properties) ||
    JSON.stringify(generations) !== JSON.stringify(baseline.current.generations);
  const changeProperties = (values: PropertyDraft) => {
    prepared.current = null;
    lookup.current?.abort();
    setGenerations(current => Object.fromEntries(Object.entries(current).filter(([key]) => values[key] === properties[key])));
    setReviewKeys((keys) => keys.filter((key) => values[key] === properties[key]));
    setProperties(
      !initial && !archived && definition
        ? Object.fromEntries(Object.entries(values).filter(([key]) => !definition.schema.properties[key]?.readOnly))
        : values,
    );
  };
  const changes = (): ConfirmationValue[] => {
    if (!initial || archived || !definition) return [];
    // Only validated, writable values are sent by this form. Match that same input.
    let next: ReturnType<typeof propertyValues>;
    try { next = propertyValues(definition, properties); } catch { return []; }
    const presentation = schemaPresentation(definition);
    return presentation.order.flatMap(key => {
      const field = definition.schema.properties[key];
      if (field.readOnly || field.deprecated || presentation.archived.includes(key) || initial.properties[key] === next[key]) return [];
      const labels = presentation.option_labels[key];
      return [{ label: field.title ?? key, value: <ChangedValue before={displayedProperty(field, initial.properties[key], labels, definition.identifier_kinds)} after={displayedProperty(field, next[key], labels, definition.identifier_kinds)}/> }];
    });
  };
  const previewTitle = (() => {
    if (!definition) return label;
    try {
      return renderEntityTitle(definition.schema, propertyValues(definition, effectiveProperties), (archived ?? initial)?.identity_label ?? "");
    } catch {
      return label;
    }
  })();
  return (
    <>
      <FormModal
        open
        visible={readable}
        domain={label}
        description="식별자 종류와 원본 값을 확인하고, 자료의 입력 항목을 작성합니다."
        title={`${label} ${archived ? "복원" : initial ? "편집" : "추가"}`}
        submitLabel={submitLabel}
        submitDisabled={!canWrite || !!typeId &&
          (!types || catalogError || !definition || schemaReading || !!pendingDefinition)}
        mutation={{
          target: previewTitle,
          action: archived ? "복원" : initial ? "수정" : "등록",
          message: context,
          data: changes(),
        }}
        dirty={dirty}
        deletion={deletion}
        onClose={onClose}
        onRouteDiscard={onRouteDiscard}
        preparation={async () => {
          if (!canWrite) throw new ApiError(403, "forbidden", "이 자료 종류의 편집 권한이 필요합니다.");
          const existing = archived ?? await checkExisting();
          const command: EntityFormSubmission = existing && !archived
            ? { action: "restore", id: existing.id, input: {
              schema_version: definition!.schema_version,
              properties: Object.fromEntries(
                Object.entries(existing.properties).filter(([key]) =>
                  !schemaPresentation(definition!).archived.includes(key) && !definition!.schema.properties[key]?.readOnly
                ),
              ),
              expected_version: existing.version,
            } }
            : submission();
          return {
            model: "entity",
            action: command.action,
            target_id: command.action === "create" ? undefined : command.id,
            expected_version: command.action === "create" ? undefined : command.input.expected_version,
            input: command.input,
          };
        }}
        onPrepared={(result) => {
          prepared.current = result.prepared_input;
        }}
        validate={() => {
          if (!canWrite) return { entity_type_id: "이 자료 종류의 편집 권한이 필요합니다." };
          if (!initial && activeType?.archived) {
            return {
              entity_type_id: "보관된 자료 종류에는 새 자료를 추가할 수 없습니다",
            };
          }
          if (!types || catalogError || !definition) {
            return {
              entity_type_id: "자료 종류와 속성 정의를 확인하세요",
            };
          }
          if (schemaReading || pendingDefinition) return { entity_type_id: "현재 속성 정의를 확인한 뒤 적용하세요" };
          if (reviewKeys.length) {
            return Object.fromEntries(
              reviewKeys.map(
                (key) => [
                  `properties.${key}`,
                  "속성 타입이 변경되었습니다. 보존한 초안을 확인하고 새 타입으로 다시 입력하세요.",
                ],
              ),
            );
          }
          let fields;
          try {
            fields = value();
          } catch (error) {
            if (error instanceof PropertyDraftError) return error.fields;
            throw error;
          }
          const errors: Record<string, string> = {};
          for (const [key, field] of Object.entries(definition.schema.properties)) {
            if (field["x-identifier"]?.allowed_kind_ids.some(id => !definition.identifier_kinds?.some(kind => kind.id === id))) {
              errors[`properties.${key}`] = "식별자 종류를 읽지 못했습니다. 현재 정의를 다시 확인하세요.";
            }
          }
          for (
            const key of definition.schema.required
          ) {
            if (
              properties[key] === undefined && !generations[key] && !definition.schema.properties[key]?.deprecated &&
              !definition.schema.properties[key]?.readOnly
            ) {
              errors[
                `properties.${key}`
              ] = "필수 입력입니다";
            }
          }
          for (
            const [key, old] of Object.entries(initial?.properties ?? {})
          ) {
            if (old !== undefined && properties[key] === undefined && !generations[key]) {errors[`properties.${key}`] =
                "기존 값을 지우려면 값 없음으로 변경하세요. 미입력은 기존 값을 유지합니다.";}
          }
          const parsed = entityCreate.safeParse(fields);
          return Object.keys(errors).length ? errors : parsed.success ? null : fieldErrors(parsed.error.issues);
        }}
        onSubmit={async (requestKey, memo) => {
          if (!canWrite) throw new ApiError(403, "forbidden", "이 자료 종류의 편집 권한이 필요합니다.");
          const current = submission();
          try {
            await onSave(
              { ...current, input: { ...current.input, ...prepared.current, ...memo } } as EntityFormSubmission,
              requestKey,
            );
          } catch (error) {
            if (error instanceof ApiError && error.code === "settings_changed") {
              setSchemaError("식별자 종류 또는 정의가 변경되었습니다. 입력을 유지했으니 현재 정의를 확인하세요.");
            }
            throw error;
          }
        }}
      >
        {(errors, frozen) => (
          <>
            {typeId && !canWrite && <Notice>현재 읽기 전용입니다. 초안과 처리 중인 요청은 유지됩니다.</Notice>}
            {context}
            <DataFieldGroup>
              {catalogError && (
                <p className="text-sm text-destructive" role="alert">
                  자료 종류를 읽지 못했습니다.{" "}
                  <Button variant="outline" type="button"  onClick={retryCatalog}>자료 종류 다시 조회</Button>
                </p>
              )}
              {!initial && !archived && !fixedType && (
                <>
                  <EntityTypePicker
                    types={writableTypes ?? []}
                    value={typeId}
                    disabled={!types || frozen}
                    catalogState={types === null ? catalogError ? "unavailable" : "loading" : "ready"}
                    error={errors.entity_type_id}
                    onChange={(selected) => {
                      if (selected === typeId) {
                        return;
                      }
                      if (dirty) {
                        setNextType(selected);
                      } else {
                        initializedType.current = null;
                        setTypeId(selected);
                      }
                    }}
                  />
                </>
              )}
              {types && !types.some((type) =>
                !type.archived
              ) && !initial && (
                <FieldGroup className="flex min-w-0 flex-col gap-5">
                  <p className="text-sm text-muted-foreground">
                    {types.length ? "모든 자료 종류가 보관되어 있습니다." : "아직 자료 종류가 없습니다."}
                  </p>
                  <Button asChild variant="ghost"><Link className="" to={types.length ? "/settings/materials" : "/settings/entity-types"}>
                    <>{types.length ? null : <PlusIcon data-icon="inline-start" />}
                      {types.length ? "보관된 종류 관리" : "자료 종류 추가"}
                    </>
                  </Link></Button>
                </FieldGroup>
              )}
              {schemaError && <p className="text-sm text-destructive" role="alert">{schemaError}</p>}
              {typeId && (schemaError || errors.schema_version || Object.keys(errors).some(key => key.startsWith("properties.")) ||
                definition && activeType && definition.schema_version !== activeType.schema_version) &&
                (
                  <Button variant="outline"
                    type="button"

                    disabled={schemaReading || frozen || !canWrite}
                    onClick={() => void readDefinition()}
                  >
                    {schemaReading ? "현재 정의 확인 중…" : "속성 정의 다시 조회"}
                  </Button>
                )}
              {pendingDefinition && (
                <section aria-label="현재 속성 정의 검토">
                  <p>
                    현재 정의 버전{" "}
                    {pendingDefinition.schema_version}. 보존한 입력을 검토한 뒤 적용하세요. 값과 자료 버전은 자동
                    변경하지 않습니다.
                  </p>
                  <ul>
                    {schemaPresentation(pendingDefinition).order.map((key) => (
                      <li key={key}>
                        {pendingDefinition.schema.properties[key].title ?? key} ·{" "}
                        {String(pendingDefinition.schema.properties[key].type)}
                        {pendingDefinition.schema.required.includes(key) ? " · 필수" : ""}
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" type="button"  onClick={acceptDefinition}>확인한 정의로 편집</Button>
                  <Button variant="outline"
                    type="button"

                    onClick={() => setPendingDefinition(null)}
                  >
                    정의 검토 취소
                  </Button>
                </section>
              )}
              {definition && <DataFields><div><dt>제목 미리보기</dt><dd>{previewTitle || "저장 후 발급되는 자료 식별자"}</dd></div></DataFields>}
              {!initial && !archived && definition?.schema["x-identity-property"] &&
                typeof properties[definition.schema["x-identity-property"]!] === "string" &&
                !generations[definition.schema["x-identity-property"]!] && (
                <Button variant="outline" type="button" disabled={frozen || !canWrite} onClick={() =>
                  void checkExisting().catch(error => {
                    if (!(error instanceof DOMException && error.name === "AbortError")) {
                      setIdentityMessage(error instanceof Error ? error.message : "조회하지 못했습니다");
                    }
                  })}>기존 대상 확인</Button>
              )}
              {identityMessage && <p role="status" className="text-sm text-muted-foreground">{identityMessage}</p>}
              {(initial || archived) && errors.entity_type_id && (
                <p className="text-sm text-destructive" role="alert">{errors.entity_type_id}</p>
              )}
              {definition
                ? (
                  <PropertyFields
                  disabled={frozen || !canWrite}
                    identityLocked={!!initial || !!archived}
                    generations={generations}
                    onGenerate={archived ? undefined : (key, kind) => {
                      prepared.current = null;
                      lookup.current?.abort();
                      setGenerations(current => {
                        const next = { ...current };
                        if (kind === undefined) delete next[key]; else next[key] = kind;
                        return next;
                      });
                    }}
                    definition={definition}
                    values={effectiveProperties}
                  initialValues={initial && !archived ? baseline.current.properties : undefined}
                    errors={errors}
                    onChange={changeProperties}
                  />
                )
                : typeId && !schemaError && <p role="status">속성 정의를 불러오는 중…</p>}
            </DataFieldGroup>
            {(initial || archived) && (
              <section className="flex min-w-0 flex-col gap-5">
                <ReadonlyTags scope="entity" ids={(archived ?? initial)!.tag_ids} />
              </section>
            )}
            {relations}
            {details}
          </>
        )}
      </FormModal>
      <ConfirmDialog
        open={nextType !== null}
        title="자료 종류를 바꿀까요?"
        message="입력한 속성은 다른 자료 종류로 옮기지 않습니다."
        confirmLabel="종류 변경"
        onCancel={() => setNextType(null)}
        onConfirm={() => {
          lookup.current?.abort();
          setArchived(null);
          initializedType.current = null;
          prepared.current = null;
          setTypeId(nextType!);
          setProperties({});
          setGenerations({});
          setIdentityMessage("");
          setNextType(null);
        }}
      />
    </>
  );
}
