import { useEntityWriteAccess } from "./entity-access.ts";
import { useApi } from "../../lib/api-context.tsx";
import { cn } from "../../lib/utils.ts";
import { FieldGroup } from "../../components/ui/field.tsx";
import { PlusIcon } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import type { EntityTypeIdentity } from "@contracts/entity-issuer.ts";
import { Link } from "../../lib/workspace-router.tsx";
import { EntityTypePicker } from "./EntityTypePicker.tsx";
import { entityId, entityIdentity, entityPath } from "@contracts/entity-identity.ts";
import { ApiError } from "../../lib/api.ts";
import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import { type EntityCreate, entityCreate, type EntityDetail } from "@contracts/entity.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { useEntityTypes } from "./useEntityTypes.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Field } from "../../components/Field.tsx";

import { fieldErrors } from "../../lib/format.ts";
import { ReadonlyTags } from "../tags/TagConnections.tsx";
import {
  fieldType,
  type PropertyDraft,
  propertyDraft,
  PropertyDraftError,
  PropertyFields,
  propertyValues,
} from "./property-fields.tsx";
export function EntityForm({
  initial,
  initialTypeId,
  initialTypeLabel,
  fixedType = false,
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
  context?: ReactNode;
  submitLabel?: string;
  details?: ReactNode;
  relations?: ReactNode;
  deletion?: DeletionOptions;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (value: EntityCreate, requestKey: () => string) => Promise<void>;
}) {
  const api = useApi(), canWriteType = useEntityWriteAccess();
  const [identitySettings, setIdentitySettings] = useState<EntityTypeIdentity | null>(null),
    [typeId, setTypeId] = useState(initial?.entity_type_id ?? initialTypeId ?? ""),
    [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaError, setSchemaError] = useState(""),
    [pendingDefinition, setPendingDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaReading, setSchemaReading] = useState(false),
    [reviewKeys, setReviewKeys] = useState<string[]>([]),
    [identityReload, setIdentityReload] = useState(0),
    [nextType, setNextType] = useState<string | null>(null);
  const { types, error: catalogError, retry: retryCatalog } = useEntityTypes();
  const canWrite = canWriteType(typeId);
  const writableTypes = types?.filter((type) => !type.archived && canWriteType(type.id));
  const [archived, setArchived] = useState<EntityDetail | null>(initial?.deleted_at ? initial : null),
    [identityMessage, setIdentityMessage] = useState(""),
    [identityStale, setIdentityStale] = useState(false);
  const [source, setSource] = useState(initial?.source ?? ""),
    [external, setExternal] = useState(initial?.external_id ?? ""),
    [properties, setProperties] = useState<PropertyDraft>(propertyDraft(initial?.properties ?? {}));
  const baseline = useRef({
    source: initial?.source ?? "",
    external: initial?.external_id ?? "",
    properties: propertyDraft(initial?.properties ?? {}),
    typeId: initial?.entity_type_id ?? initialTypeId ?? "",
  });
  const prepared = useRef<Record<string, unknown> | null>(null),
    initializedType = useRef<string | null>(null),
    settingsVersion = useRef<number | undefined>(undefined),
    lookup = useRef<AbortController | null>(null),
    definitionRead = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setIdentitySettings(null);
    if (typeId) {
      void api<EntityTypeIdentity>("GET", `/entity-types/${typeId}/identity`, undefined, c.signal).then((settings) => {
        if (c.signal.aborted) return;
        settingsVersion.current = settings.version;
        setIdentitySettings(settings);
        setIdentityStale(false);
        if (!initial && !source) {
          setSource(settings.default_source);
          baseline.current.source = settings.default_source;
        }
      }).catch(() => {
        if (!c.signal.aborted) {
          setIdentityMessage("자료 번호 설정을 읽지 못했습니다. 다시 조회하세요.");
        }
      });
    }
    return () => {
      c.abort();
      lookup.current?.abort();
    };
  }, [typeId, identityReload]);
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
          setProperties(draft);
          baseline.current.properties = draft;
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
      field ? `${fieldType(field)}:${field.format ?? ""}:${fieldChoices(field) ? "selection" : ""}` : "missing";
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
      source,
      external_id: external || undefined,
      identity_version: !initial || archived ? settingsVersion.current : undefined,
      expected_version: archived?.version,
    };
  };
  const checkExisting = async () => {
    if (initial || archived) return archived;
    if (!identitySettings) throw new Error("자료 번호 설정을 확인하세요");
    if (!external && identitySettings.sources.find((item) => item.code === source)?.generation === "automatic") {
      return null;
    }
    const identity = entityIdentity.safeParse({ source, entity_type_id: typeId, external_id: external });
    if (!identity.success) throw new Error(identity.error.issues.map((i) => i.message).join(" · "));
    lookup.current?.abort();
    const c = new AbortController();
    lookup.current = c;
    try {
      const stored = await api<EntityDetail>(
        "GET",
        entityPath(entityId(source, typeId, external)),
        undefined,
        c.signal,
      );
      c.signal.throwIfAborted();
      if (!stored.deleted_at) throw new Error("같은 번호 출처·자료 번호의 활성 자료가 있습니다.");
      if (stored.entity_type_id !== typeId) {
        throw new Error("삭제된 자료의 종류가 다릅니다. 원래 자료 종류에서 복원하세요.");
      }
      setArchived(stored);
      setProperties(propertyDraft(stored.properties));
      setIdentityMessage("보관한 자료를 불러왔습니다. 속성과 연결을 확인한 뒤 복원을 저장하세요.");
      return stored;
    } catch (e) {
      c.signal.throwIfAborted();
      if (e instanceof ApiError && e.status === 404) {
        setIdentityMessage("새로운 자료 번호입니다.");
        return null;
      }
      throw e;
    }
  };
  const dirty = source !== baseline.current.source || external !== baseline.current.external ||
    typeId !== baseline.current.typeId || JSON.stringify(properties) !== JSON.stringify(baseline.current.properties);
  const changeProperties = (values: PropertyDraft) => {
    lookup.current?.abort();
    setReviewKeys((keys) => keys.filter((key) => values[key] === properties[key]));
    setProperties(
      !initial && !archived && definition
        ? Object.fromEntries(Object.entries(values).filter(([key]) => !definition.schema.properties[key]?.readOnly))
        : values,
    );
  };
  return (
    <>
      <FormModal
        open
        domain={label}
        description="번호 출처와 번호를 확인하고, 자료의 입력 항목을 작성합니다."
        title={`${label} ${archived ? "복원" : initial ? "편집" : "추가"}`}
        submitLabel={submitLabel}
        submitDisabled={!canWrite || !!typeId &&
          (!identitySettings || !types || catalogError || !definition || schemaReading || !!pendingDefinition)}
        mutation={{
          target: definition
            ? String(effectiveProperties[schemaPresentation(definition).representative] ?? label)
            : label,
          action: archived ? "복원" : initial ? "수정" : "등록",
          message: context,
        }}
        dirty={dirty}
        deletion={deletion}
        onClose={onClose}
        onRouteDiscard={onRouteDiscard}
        preparation={async () => {
          if (!canWrite) throw new ApiError(403, "forbidden", "이 자료 종류의 편집 권한이 필요합니다.");
          const existing = archived ?? await checkExisting(), target = existing ?? initial;
          const input = existing && !archived
            ? {
              ...value(),
              properties: Object.fromEntries(
                Object.entries(existing.properties).filter(([key]) =>
                  !schemaPresentation(definition!).archived.includes(key)
                ),
              ),
              expected_version: existing.version,
            }
            : value();
          if (initial && !existing) {
            const {
              entity_type_id: _type,
              identity_version: _settings,
              source: _source,
              external_id: _number,
              ...patch
            } = input;
            return {
              model: "entity",
              action: "update",
              target_id: initial.id,
              expected_version: initial.version,
              input: patch,
            };
          }
          return {
            model: "entity",
            action: existing ? "restore" : "create",
            target_id: target?.id,
            expected_version: target?.version,
            input,
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
          if (!identitySettings || !types || catalogError || !definition) {
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
          if (identitySettings.sources.find((item) => item.code === source)?.generation === "direct" && !external) {
            return {
              external_id: "자료 번호를 입력하세요",
            };
          }
          const errors: Record<string, string> = {};
          for (
            const key of definition.schema.required
          ) {
            if (
              properties[key] === undefined && !definition.schema.properties[key]?.deprecated &&
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
            if (old !== undefined && properties[key] === undefined) {errors[`properties.${key}`] =
                "기존 값을 지우려면 값 없음으로 변경하세요. 미입력은 기존 값을 유지합니다.";}
          }
          if (!String(effectiveProperties[schemaPresentation(definition).representative] ?? "").trim()) {
            errors[
              `properties.${schemaPresentation(definition).representative}`
            ] = "이름은 공백만 입력할 수 없습니다";
          }
          const parsed = entityCreate.safeParse(fields);
          return Object.keys(errors).length ? errors : parsed.success ? null : fieldErrors(parsed.error.issues);
        }}
        onSubmit={async (requestKey, memo) => {
          if (!canWrite) throw new ApiError(403, "forbidden", "이 자료 종류의 편집 권한이 필요합니다.");
          const current = value();
          try {
            await onSave(
              { ...current, ...prepared.current, ...memo } as EntityCreate,
              requestKey,
            );
          } catch (error) {
            if (error instanceof ApiError && error.code === "settings_changed") {
              setIdentityStale(true);
              setIdentityMessage("자료 번호 설정이 변경되었습니다. 입력을 유지했으니 현재 설정을 확인하세요.");
            }
            throw error;
          }
        }}
      >
        {(errors, frozen) => (
          <>
            {typeId && !canWrite && <Notice>현재 읽기 전용입니다. 초안과 처리 중인 요청은 유지됩니다.</Notice>}
            {context}
            <section className="flex-col grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
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
              {typeId && (schemaError || errors.schema_version ||
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
              {(!identitySettings || identityStale) && typeId && (
                <Button variant="outline"
                  type="button"

                  onClick={() => setIdentityReload((value) => value + 1)}
                >
                  자료 번호 설정 다시 조회
                </Button>
              )}
              {definition && (
                <PropertyFields
                  disabled={frozen || !canWrite}
                  part="representative"
                  definition={definition}
                  values={effectiveProperties}
                  errors={errors}
                  onChange={changeProperties}
                />
              )}
              {(initial || archived)
                ? (
                  <dl className="min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere">
                    <div>
                      <dt>번호 출처</dt>
                      <dd>
                        {identitySettings?.sources.find((item) => item.code === source)?.source_label ??
                          initial?.source_label ?? source}
                      </dd>
                    </div>
                  </dl>
                )
                : identitySettings?.sources.filter((item) => item.active).length === 1
                ? (
                  <dl className="min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere">
                    <div>
                      <dt>번호 출처</dt>
                      <dd>
                        {identitySettings.sources.find((item) => item.active)?.source_label}
                        {errors.source && <p className="text-sm text-destructive" role="alert">{errors.source}</p>}
                      </dd>
                    </div>
                  </dl>
                )
                : (
                  <Field label="번호 출처" required error={errors.source}>
                    {(p) => (
                      <NativeSelect
                        {...p}

                        value={source}
                        disabled={frozen || !canWrite || !identitySettings || !!initial || !!archived}
                        onChange={(e) => {
                          lookup.current?.abort();
                          setSource(e.target.value);
                          if (!initial) setExternal("");
                        }}
                      >
                        {identitySettings?.sources.filter((item) =>
                          item.active
                        ).map(
                          (item) => (
                            <NativeSelectOption key={item.code} value={item.code} disabled={!item.active}>
                              {item.source_label}
                            </NativeSelectOption>
                          ),
                        )}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              {initial || archived
                ? (
                  <dl className="min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere">
                    <div>
                      <dt>자료 번호</dt>
                      <dd className="wrap-anywhere tabular-nums">{external}</dd>
                    </div>
                  </dl>
                )
                : identitySettings?.sources.find((item) => item.code === source)?.generation === "automatic"
                ? (
                  <dl className="min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere">
                    <div>
                      <dt>{identitySettings.label}</dt>
                      <dd>
                        등록 시 자동 발급
                        {errors.external_id && <p className="text-sm text-destructive" role="alert">{errors.external_id}</p>}
                      </dd>
                    </div>
                  </dl>
                )
                : (
                  <Field label={identitySettings?.label ?? "번호"} error={errors.external_id}>
                    {(p) => (
                      <Input
                        {...p}

                        value={external}
                        maxLength={200}
                        disabled={frozen || !canWrite || !identitySettings}
                        readOnly={!!initial || !!archived ||
                          identitySettings?.sources.find((item) => item.code === source)?.generation === "automatic"}
                        placeholder={identitySettings?.sources.find((item) => item.code === source)?.generation ===
                            "automatic"
                          ? "자동 발급"
                          : undefined}
                        onChange={(e) => {
                          lookup.current?.abort();
                          setExternal(e.target.value);
                        }}
                      />
                    )}
                  </Field>
                )}
              {!initial && !archived && external &&
                identitySettings?.sources.find((item) => item.code === source)?.generation === "direct" && (
                <Button variant="outline"
                  type="button"

                  disabled={frozen || !canWrite || !identitySettings || !definition}
                  onClick={() =>
                    void checkExisting().catch((e) => {
                      if (!(e instanceof DOMException && e.name === "AbortError")) {
                        setIdentityMessage(e instanceof Error ? e.message : "조회하지 못했습니다");
                      }
                    })}
                >
                  기존 대상 확인
                </Button>
              )}
              {(!identitySettings || !types) && !identityMessage && !catalogError && (
                <p role="status">자료 종류·자료 번호 설정을 읽는 중…</p>
              )}
              {identityMessage && (
                <p
                  className={cn(!identitySettings ? "text-sm text-destructive" : undefined)}
                  role={!identitySettings ? "alert" : "status"}
                >
                  {identityMessage}
                </p>
              )}
              {(initial || archived) && errors.entity_type_id && (
                <p className="text-sm text-destructive" role="alert">{errors.entity_type_id}</p>
              )}
              {definition
                ? (
                  <PropertyFields
                  disabled={frozen || !canWrite}
                    part="remaining"
                    definition={definition}
                    values={effectiveProperties}
                    errors={errors}
                    onChange={changeProperties}
                  />
                )
                : typeId && !schemaError && <p role="status">속성 정의를 불러오는 중…</p>}
            </section>
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
          setExternal("");
          setSource("");
          setIdentityMessage("");
          setNextType(null);
        }}
      />
    </>
  );
}
