import {
  defaultEntityIdentitySettings,
  entityId,
  entityIdentity,
  type EntityIdentitySettings,
  entityPath,
  entitySourceGeneration,
} from "@contracts/entity-identity.ts";
import { api, ApiError } from "../../lib/api.ts";
import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import { type EntityCreate, entityCreate, type EntityDetail } from "@contracts/entity.ts";
import type { EntitySchemaResult, EntityType } from "@contracts/entity-type.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
import { TagPicker } from "../tags/TagPicker.tsx";
import { fieldType, type PropertyDraft, propertyDraft, PropertyFields, propertyValues } from "./property-fields.tsx";
export function EntityForm({
  initial,
  initialTypeId,
  initialTypeLabel,
  details,
  deletion,
  onClose,
  onRouteDiscard,
  onSave,
}: {
  initial?: EntityDetail;
  initialTypeId?: string;
  initialTypeLabel?: string;
  details?: ReactNode;
  deletion?: DeletionOptions;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (value: EntityCreate & { tag_ids: string[] }, requestKey: () => string) => Promise<void>;
}) {
  const [identitySettings, setIdentitySettings] = useState<EntityIdentitySettings | null>(null),
    [types, setTypes] = useState<EntityType[] | null>(null),
    [typeId, setTypeId] = useState(initial?.entity_type_id ?? initialTypeId ?? ""),
    [definition, setDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaError, setSchemaError] = useState(""),
    [pendingDefinition, setPendingDefinition] = useState<EntitySchemaResult | null>(null),
    [schemaReading, setSchemaReading] = useState(false),
    [reviewKeys, setReviewKeys] = useState<string[]>([]),
    [reload, setReload] = useState(0),
    [nextType, setNextType] = useState<string | null>(null);
  const [archived, setArchived] = useState<EntityDetail | null>(initial?.deleted_at ? initial : null),
    [identityMessage, setIdentityMessage] = useState("");
  const [source, setSource] = useState(initial?.source ?? ""),
    [external, setExternal] = useState(initial?.external_id ?? ""),
    [properties, setProperties] = useState<PropertyDraft>(propertyDraft(initial?.properties ?? {})),
    [tags, setTags] = useState(initial?.tag_ids ?? []);
  const baseline = useRef({
    source: initial?.source ?? "",
    external: initial?.external_id ?? "",
    properties: propertyDraft(initial?.properties ?? {}),
    tags: initial?.tag_ids ?? [],
    typeId: initial?.entity_type_id ?? initialTypeId ?? "",
  });
  const prepared = useRef<Record<string, unknown> | null>(null),
    initializedType = useRef<string | null>(null),
    settingsVersion = useRef<number | undefined>(undefined),
    lookup = useRef<AbortController | null>(null),
    definitionRead = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      api<{ settings: { entity_identity: EntityIdentitySettings }; versions: { entity_identity: number } }>(
        "GET",
        "/settings/business?id=entity_identity",
        undefined,
        c.signal,
      ),
      api<{ items: EntityType[] }>("GET", "/entity-types?include_archived=true&limit=100", undefined, c.signal),
    ]).then(([saved, list]) => {
      if (c.signal.aborted) return;
      const settings = saved.settings.entity_identity ?? defaultEntityIdentitySettings;
      settingsVersion.current = saved.versions.entity_identity;
      setIdentitySettings(settings);
      setTypes(list.items);
      if (!initial) {
        setSource(settings.default_source);
        baseline.current.source = settings.default_source;
      }
    }).catch(() => {
      if (!c.signal.aborted) setIdentityMessage("자료 종류·식별자 설정을 읽지 못했습니다. 다시 열어 주세요.");
    });
    return () => {
      c.abort();
      lookup.current?.abort();
      definitionRead.current?.abort();
    };
  }, []);
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
              field.default !== undefined && !value.display.archived.includes(key)
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
  }, [typeId, reload]);
  const readDefinition = async () => {
    if (!typeId || schemaReading) return;
    const controller = new AbortController();
    definitionRead.current?.abort();
    definitionRead.current = controller;
    setSchemaReading(true);
    setSchemaError("");
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
      field ? `${fieldType(field)}:${field.format ?? ""}:${field.enum ? "selection" : ""}` : "missing";
    setReviewKeys(
      Object.keys(properties).filter((key) =>
        kind(definition?.schema.properties[key]) !== kind(pendingDefinition.schema.properties[key])
      ),
    );
    setDefinition(pendingDefinition);
    setPendingDefinition(null);
    prepared.current = null;
  };
  const activeType = types?.find((type) => type.id === typeId),
    label = activeType?.label ?? initial?.type.label ?? initialTypeLabel ?? "자료";
  const value = () => {
    if (!definition) throw new Error("자료 종류와 속성 정의를 확인하세요");
    const values = propertyValues(definition, properties);
    const writable = Object.fromEntries(
      Object.entries(values).filter(([key]) => !definition.display.archived.includes(key)),
    );
    return {
      entity_type_id: typeId,
      schema_version: definition.schema_version,
      properties: writable,
      source,
      external_id: external || undefined,
      settings_version: !initial ? settingsVersion.current : undefined,
      expected_version: archived?.version,
      tag_ids: tags,
    };
  };
  const checkExisting = async () => {
    if (initial || archived) return archived;
    if (!identitySettings) throw new Error("식별자 설정을 확인하세요");
    if (!external && entitySourceGeneration(identitySettings, source) === "short") return null;
    const identity = entityIdentity.safeParse({ source, external_id: external });
    if (!identity.success) throw new Error(identity.error.issues.map((i) => i.message).join(" · "));
    lookup.current?.abort();
    const c = new AbortController();
    lookup.current = c;
    try {
      const stored = await api<EntityDetail>("GET", entityPath(entityId(source, external)), undefined, c.signal);
      c.signal.throwIfAborted();
      if (!stored.deleted_at) throw new Error("같은 발급처·식별자의 활성 자료가 있습니다.");
      if (stored.entity_type_id !== typeId) {
        throw new Error("삭제된 자료의 종류가 다릅니다. 원래 자료 종류에서 복원하세요.");
      }
      setArchived(stored);
      setProperties(propertyDraft(stored.properties));
      setTags(stored.tag_ids);
      setIdentityMessage("보관한 자료를 불러왔습니다. 속성과 연결을 확인한 뒤 복원을 저장하세요.");
      return stored;
    } catch (e) {
      c.signal.throwIfAborted();
      if (e instanceof ApiError && e.status === 404) {
        setIdentityMessage("새로운 식별자입니다.");
        return null;
      }
      throw e;
    }
  };
  const dirty = source !== baseline.current.source || external !== baseline.current.external ||
    typeId !== baseline.current.typeId || JSON.stringify(properties) !== JSON.stringify(baseline.current.properties) ||
    JSON.stringify(tags) !== JSON.stringify(baseline.current.tags);
  return (
    <>
      <FormModal
        open
        domain={label}
        title={`${label} ${archived ? "복원" : initial ? "편집" : "추가"}`}
        submitLabel="저장"
        mutation={{
          target: definition ? String(properties[definition.display.representative] ?? label) : label,
          action: archived ? "복원" : initial ? "수정" : "등록",
        }}
        dirty={dirty}
        deletion={deletion}
        onClose={onClose}
        onRouteDiscard={onRouteDiscard}
        preparation={async () => {
          const existing = archived ?? await checkExisting(), target = existing ?? initial;
          const input = existing && !archived
            ? { ...value(), properties: existing.properties, expected_version: existing.version }
            : value();
          if (initial && !existing) {
            const { entity_type_id: _type, settings_version: _settings, ...patch } = input;
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
          if (!identitySettings || !definition) return { entity_type_id: "자료 종류와 속성 정의를 확인하세요" };
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
          const fields = value();
          if (entitySourceGeneration(identitySettings, source) === "manual" && !external) {
            return {
              external_id: "식별자를 입력하세요",
            };
          }
          const errors: Record<string, string> = {};
          for (
            const key of definition.schema.required
          ) {
            if (properties[key] === undefined && !definition.display.archived.includes(key)) {
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
          if (!String(properties[definition.display.representative] ?? "").trim()) {
            errors[
              `properties.${definition.display.representative}`
            ] = "이름은 공백만 입력할 수 없습니다";
          }
          const parsed = entityCreate.safeParse(fields);
          return Object.keys(errors).length ? errors : parsed.success ? null : fieldErrors(parsed.error.issues);
        }}
        onSubmit={async (requestKey, memo) => {
          const current = value();
          return onSave(
            { ...current, ...prepared.current, tag_ids: tags, ...memo } as EntityCreate & { tag_ids: string[] },
            requestKey,
          );
        }}
      >
        {(errors) => (
          <>
            <section className="detail-section form">
              {initial || archived
                ? <p>자료 종류: {label} · 저장 후 종류를 변경할 수 없습니다.</p>
                : (
                  <Field label="자료 종류" required error={errors.entity_type_id}>
                    {(p) => (
                      <select
                        {...p}
                        className="input"
                        value={typeId}
                        disabled={!types}
                        onChange={(e) => {
                          const selected = e.target.value;
                          if (dirty) setNextType(selected);
                          else setTypeId(selected);
                        }}
                      >
                        <option value="">자료 종류 선택</option>
                        {types?.filter((type) => !type.archived).map((type) => (
                          <option key={type.id} value={type.id}>{type.label}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
              {types && !types.some((type) => !type.archived) && !initial && (
                <p>
                  활성 자료 종류가 없습니다. <a href="/settings/entity-types">자료 종류 만들기·보관 관리</a>
                </p>
              )}
              {definition && (
                <p className="help">
                  편집 정의 버전 {definition.schema_version}
                  {initial ? ` · 자료 버전 ${initial.version}` : ""}. 정의를 다시 읽어도 초안과 자료 버전은 유지됩니다.
                </p>
              )}
              {schemaError && <p role="alert">{schemaError}</p>}
              {typeId && (
                <button
                  type="button"
                  className="btn"
                  disabled={schemaReading}
                  onClick={() => void readDefinition()}
                >
                  {schemaReading ? "현재 정의 확인 중…" : "속성 정의 다시 조회"}
                </button>
              )}
              {pendingDefinition && (
                <section aria-label="현재 속성 정의 검토">
                  <p>
                    현재 정의 버전{" "}
                    {pendingDefinition.schema_version}. 보존한 입력을 검토한 뒤 적용하세요. 값과 자료 버전은 자동
                    변경하지 않습니다.
                  </p>
                  <ul>
                    {pendingDefinition.display.order.map((key) => (
                      <li key={key}>
                        {pendingDefinition.schema.properties[key].title ?? key} ·{" "}
                        {String(pendingDefinition.schema.properties[key].type)}
                        {pendingDefinition.schema.required.includes(key) ? " · 필수" : ""}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn" onClick={acceptDefinition}>확인한 정의로 편집</button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPendingDefinition(null)}
                  >
                    정의 검토 취소
                  </button>
                </section>
              )}
              <Field label="발급처" required error={errors.source}>
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={source}
                    disabled={!identitySettings || !!archived}
                    onChange={(e) => {
                      lookup.current?.abort();
                      setSource(e.target.value);
                      if (!initial) setExternal("");
                    }}
                  >
                    {identitySettings?.sources.filter((item) =>
                      !item.deleted || item.code === initial?.source
                    ).map(
                      (item) => <option key={item.code} value={item.code} disabled={item.deleted}>{item.label}</option>,
                    )}
                  </select>
                )}
              </Field>
              <Field label="식별자" error={errors.external_id}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    value={external}
                    maxLength={200}
                    disabled={!identitySettings || !!archived}
                    placeholder="자동 발급은 비워 두세요"
                    onChange={(e) => {
                      lookup.current?.abort();
                      setExternal(e.target.value);
                    }}
                  />
                )}
              </Field>
              {!initial && !archived && (
                <button
                  type="button"
                  className="btn"
                  disabled={!identitySettings || !definition}
                  onClick={() =>
                    void checkExisting().catch((e) => {
                      if (!(e instanceof DOMException && e.name === "AbortError")) {
                        setIdentityMessage(e instanceof Error ? e.message : "조회하지 못했습니다");
                      }
                    })}
                >
                  기존 대상 확인
                </button>
              )}
              {identityMessage && <p role="status">{identityMessage}</p>}
              {definition
                ? (
                  <PropertyFields
                    definition={definition}
                    values={properties}
                    errors={errors}
                    onChange={(values) => {
                      lookup.current?.abort();
                      setReviewKeys((keys) => keys.filter((key) => values[key] === properties[key]));
                      setProperties(values);
                    }}
                  />
                )
                : typeId && <p role="status">속성 정의를 불러오는 중…</p>}
            </section>
            <section className="detail-section form">
              <TagPicker scope="entity" value={tags} error={errors.tag_ids} onChange={setTags} />
            </section>
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
          setTypeId(nextType!);
          setProperties({});
          setNextType(null);
        }}
      />
    </>
  );
}
