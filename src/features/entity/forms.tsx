import { defaultEntityIdentitySettings, entitySourceGeneration, entityIdentity, entityId, entityPath, type EntityIdentitySettings } from "@contracts/entity-identity.ts";
import { api, ApiError } from "../../lib/api.ts";
import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import {
  type EntityCreate,
  entityCreate,
  entityLabels,
  type EntityResult,
} from "@contracts/entity.ts";
import { type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
import { TagPicker } from "../tags/TagPicker.tsx";
export function EntityForm(
  { initial, details, deletion, onClose, onRouteDiscard, onSave }: {
    initial?: EntityResult;
    details?: ReactNode;
    deletion?: DeletionOptions;
    onClose: () => void;
    onRouteDiscard?: () => void;
    onSave: (value: EntityCreate & {tag_ids: string[]; change_note?: string; change_tag_ids?: string[]}, requestKey: () => string) => Promise<void>;
  },
) {
  const [identitySettings, setIdentitySettings] = useState<EntityIdentitySettings | null>(null);
  const [archived, setArchived] = useState<EntityResult | null>(initial?.deleted_at ? initial : null);
  const [identityMessage, setIdentityMessage] = useState("");
  const prepared = useRef<Record<string,unknown> | null>(null);
  const settingsVersion = useRef<number | undefined>(undefined);
  useEffect(()=>{
    const controller=new AbortController();
    void api<{settings:{entity_identity:EntityIdentitySettings};versions:{entity_identity:number}}>("GET","/settings/business",undefined,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      const settings=result.settings.entity_identity??defaultEntityIdentitySettings;
      settingsVersion.current=result.versions.entity_identity;
      setIdentitySettings(settings);
      setDraft(d=>({...d,source:initial?.source??settings.default_source,external_id:initial?.external_id??""}));
    }).catch(()=>{if(!controller.signal.aborted)setIdentityMessage("식별자 설정을 불러오지 못했습니다. 다시 열어 주세요.");});
    return()=>controller.abort();
  },[]);
  const baseline = {
    source: initial?.source ?? (identitySettings ?? defaultEntityIdentitySettings).default_source,
    external_id: initial?.external_id ?? "",
    prop1: initial?.prop1 ?? "",
    prop2: initial?.prop2 == null ? "" : String(initial.prop2),
    prop3: initial?.prop3 ?? "",
    prop4: initial?.prop4 ?? "a",
    tag_ids: (initial as EntityResult & {tag_ids?: string[]})?.tag_ids ?? [],
  };
  const [draft, setDraft] = useState(baseline);
  const lookup = useRef<AbortController | null>(null);
  const invalidateLookup = () => { lookup.current?.abort(); lookup.current = null; };
  useEffect(() => invalidateLookup, []);
  const editDraft = (update: SetStateAction<typeof draft>) => {
    invalidateLookup();
    setIdentityMessage("");
    setDraft(update);
  };
  const value = () => ({
    ...draft,
    external_id:draft.external_id || undefined,
    ...(!initial ? {settings_version:settingsVersion.current} : {}),
    ...(archived ? { expected_version: archived.version } : {}),
    prop2: draft.prop2 === "" ? null : Number(draft.prop2),
    prop3: draft.prop3 || null,
  });
  const checkExisting = async () => {
    if (initial || archived) return archived;
    if (!identitySettings) throw new Error("식별자 설정을 불러오는 중입니다.");
    if (!draft.external_id && entitySourceGeneration(identitySettings,draft.source) === "short") return null;
    const identity = entityIdentity.safeParse({source:draft.source,external_id:draft.external_id});
    if (!identity.success) throw new Error(identity.error.issues.map(issue => issue.message).join(" · "));
    invalidateLookup();
    const controller = new AbortController();
    lookup.current = controller;
    try {
      const stored = await api<EntityResult>("GET", entityPath(entityId(draft.source, draft.external_id)), undefined, controller.signal);
      controller.signal.throwIfAborted();
      if (!stored.deleted_at) throw new Error("같은 발급처·식별자의 활성 엔터티가 있습니다.");
      setArchived(stored);
      setDraft({ source: stored.source, external_id: stored.external_id, prop1: stored.prop1, prop2: stored.prop2 == null ? "" : String(stored.prop2), prop3: stored.prop3 ?? "", prop4: stored.prop4, tag_ids: stored.tag_ids });
      setIdentityMessage("삭제된 기존 데이터를 불러왔습니다. 보관값을 확인하고 복원을 저장하세요.");
      return stored;
    } catch (cause) { controller.signal.throwIfAborted(); if (cause instanceof ApiError && cause.status === 404) { setIdentityMessage("새로운 식별자입니다."); return null; } throw cause; }
    finally { if (lookup.current === controller) lookup.current = null; }
  };
  return (
    <FormModal
      open
      domain="엔터티" title={archived ? "엔터티 복원" : initial ? "엔터티 편집" : "엔터티 추가"}
      submitLabel="저장"
      mutation={{target: draft.prop1, action: archived ? "복원" : initial ? "수정" : "등록"}}
      preparation={async () => {
        const existing = archived ?? (initial?.deleted_at ? initial : null) ?? await checkExisting();
        const target = existing ?? initial;
        const preparedInput = existing && !archived ? { source:existing.source,external_id:existing.external_id,prop1:existing.prop1,prop2:existing.prop2,prop3:existing.prop3,prop4:existing.prop4,tag_ids:existing.tag_ids } : value();
        return { model:"entity", action:existing ? "restore" : initial ? "update" : "create", target_id:target?.id,expected_version:target?.version,input:preparedInput };
      }}
      onPrepared={result=>{prepared.current=result.prepared_input;}}
      deletion={deletion}
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      dirty={JSON.stringify(draft) !== JSON.stringify(baseline)}
      validate={() => {
        const {tag_ids, ...fields} = value();
        const parsed = entityCreate.safeParse(fields);
        if (!identitySettings) return { external_id: "식별자 설정을 불러오는 중입니다" };
        if (entitySourceGeneration(identitySettings, fields.source) === "manual" && !fields.external_id) return {external_id:"식별자를 입력하세요"};
        if (!fields.prop1.trim()) return { prop1: "필수 입력입니다" };
        return parsed.success ? null : fieldErrors(parsed.error.issues);
      }}
      onSubmit={async (requestKey, memo) => { const {tag_ids,...fields}=value(); return onSave({...entityCreate.parse(prepared.current ?? fields),tag_ids,...memo}, requestKey);}}
    >
      {(errors) => (
        <>
          <section className="detail-section form">
          <>
            <Field label="발급처" required error={errors.source}>{p => <select {...p} className="input" value={draft.source} disabled={!identitySettings || !!archived} onChange={e => editDraft(d => ({...d, source:e.target.value, external_id:initial ? d.external_id : ""}))}>{identitySettings?.sources.filter(source => !source.deleted || source.code === initial?.source).map(source => <option key={source.code} value={source.code} disabled={source.deleted}>{source.label}{source.deleted ? " · 삭제됨" : ""}</option>)}</select>}</Field>
            <Field label="식별자" required={!!identitySettings && entitySourceGeneration(identitySettings,draft.source)==="manual"} error={errors.external_id}>{p => <input {...p} className="input" value={draft.external_id} maxLength={200} placeholder={identitySettings && entitySourceGeneration(identitySettings,draft.source)==="short" ? "비워 두면 저장 시 자동 발급" : undefined} disabled={!identitySettings || !!archived} onChange={e => editDraft(d => ({...d, external_id:e.target.value}))}/>}</Field>
            {!initial && !archived && <button type="button" className="btn" disabled={!identitySettings} onClick={() => { void checkExisting().catch(cause => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setIdentityMessage(cause instanceof Error ? cause.message : "조회하지 못했습니다."); }); }}>기존 대상 확인</button>}
            {identityMessage && <p role="status" className="secondary">{identityMessage}</p>}
            {archived && <p className="secondary">보관된 속성·태그와 연결을 복원합니다. 입력한 변경만 반영합니다. 현재 버전 {archived.version}</p>}
          </>
          <Field
            label={entityLabels.prop1}
            required
            error={errors.prop1}

          >
            {(p) => (
              <input
                {...p}
                className="input"
                value={draft.prop1}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, prop1: e.target.value }))}
              />
            )}
          </Field>
          <Field
            label={entityLabels.prop2}
            error={errors.prop2}

          >
            {(p) => (
              <input
                {...p}
                className="input"
                type="number"
                min="0"
                max="1000000"
                step="1"
                value={draft.prop2}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, prop2: e.target.value }))}
              />
            )}
          </Field>
          <Field label={entityLabels.prop3} error={errors.prop3}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="date"
                value={draft.prop3}
                onChange={(e) =>
                  editDraft((d) => ({ ...d, prop3: e.target.value }))}
              />
            )}
          </Field>
          <Field label={entityLabels.prop4} required error={errors.prop4}>
            {(p) => (
              <select
                {...p}
                className="input"
                value={draft.prop4}
                onChange={(e) =>
                  editDraft((d) => ({
                    ...d,
                    prop4: e.target.value as EntityResult["prop4"],
                  }))}
              >
                {["a", "b", "c"].map((v) => <option key={v}>{v}</option>)}
              </select>
            )}
          </Field>
          </section><section className="detail-section form">
          <TagPicker scope="entity" value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>editDraft(d=>({...d,tag_ids}))}/>
          </section>
          {details}
        </>
      )}
    </FormModal>
  );
}
