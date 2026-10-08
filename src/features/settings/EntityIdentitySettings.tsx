import { useEffect, useState } from "react";
import { defaultEntityIdentitySettings, entityIdentitySettings, type EntityIdentitySettings as IdentitySettings } from "@contracts/entity-identity.ts";
import type { BusinessSettingsResult } from "@contracts/business-settings.ts";
import { api, ApiError } from "../../lib/api.ts";
import { Field } from "../../components/Field.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";

export function EntityIdentitySettings({onStateChange}: {onStateChange?: (state: {dirty:boolean;busy:boolean})=>void}) {
  const [saved, setSaved] = useState<BusinessSettingsResult | null>(null);
  const [draft, setDraft] = useState<IdentitySettings | null>(null);
  const [persistedSourceCount, setPersistedSourceCount] = useState(0);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false);
  const [error, setError] = useState(false);
  const [reading, setReading] = useState(false);
  const read = async (signal?: AbortSignal) => {
    setReading(true);
    try {
      const value = await api<BusinessSettingsResult>("GET", "/settings/business", undefined, signal);
      if (signal?.aborted) return;
      const latest = value.settings.entity_identity ?? defaultEntityIdentitySettings;
      if (draft) {
        const previous = saved?.settings.entity_identity ?? defaultEntityIdentitySettings;
        const sources = latest.sources.map(source => {
          const before = previous.sources.find(value => value.code === source.code);
          const edited = draft.sources.slice(0,persistedSourceCount).find(value => value.code === source.code);
          return before && edited ? {...source,
            label:edited.label === before.label ? source.label : edited.label,
            deleted:!!edited.deleted === !!before.deleted ? source.deleted : edited.deleted,
          } : source;
        });
        setDraft({...draft,
          generation:draft.generation === previous.generation ? latest.generation : draft.generation,
          default_source:draft.default_source === previous.default_source ? latest.default_source : draft.default_source,
          sources:[...sources,...draft.sources.slice(persistedSourceCount)],
        });
      } else setDraft(latest);
      setPersistedSourceCount(latest.sources.length); setSaved(value);
      setConflict(false); setMessage(draft ? "최신 설정을 확인했습니다. 입력은 유지했습니다." : ""); setError(false);
    } catch { if (!signal?.aborted) { setMessage("식별자 설정을 불러오지 못했습니다."); setError(true); } }
    finally {if(!signal?.aborted) setReading(false);}
  };
  useEffect(() => { const controller = new AbortController(); void read(controller.signal); return () => controller.abort(); }, []);
  const savedIdentity = saved?.settings.entity_identity ?? defaultEntityIdentitySettings;
  const dirty = !!saved && JSON.stringify(draft) !== JSON.stringify(savedIdentity);
  useEffect(() => { onStateChange?.({dirty,busy:busy||reading}); }, [dirty,busy,reading,onStateChange]);
  const active = draft?.sources.filter(source => !source.deleted) ?? [];
  const retired = draft?.sources.filter(source => source.deleted) ?? [];
  const isSavedSource = (index: number) => index < persistedSourceCount;
  const changeSource = (index: number, patch: Partial<IdentitySettings["sources"][number]>) => {
    setDraft(current => current && ({ ...current, sources: current.sources.map((source, i) => i === index ? { ...source, ...patch } : source) })); setMessage("");
  };
  const removeSource = (index: number) => setDraft(current => {
    if (!current) return current;
    const source = current.sources[index];
    if (current.sources.filter(value => !value.deleted).length <= 1) return current;
    const existing = isSavedSource(index);
    const sources = existing ? current.sources.map((value, i) => i === index ? {...value, deleted:true} : value) : current.sources.filter((_, i) => i !== index);
    return {...current, sources, default_source: current.default_source === source.code ? sources.find(value => !value.deleted)!.code : current.default_source};
  });
  return <section className="settings-section" aria-labelledby="entity-identity-title">
    <h2 className="settings-section-title" id="entity-identity-title">엔터티 식별자</h2>
    {message && <p className={error ? "error-text" : "secondary"} role={error ? "alert" : "status"}>{message}</p>}
    {!saved && <><p role="status">{message ? "" : "설정을 읽는 중…"}</p>{message && <button type="button" className="btn" disabled={reading} onClick={() => void read()}>다시 시도</button>}</>}
    {draft && saved && <form className="form" aria-label="엔터티 식별자 설정" aria-busy={busy||reading} onSubmit={async event => {
      event.preventDefault(); if (busy || reading || !dirty) return;
      const parsed = entityIdentitySettings.safeParse(draft);
      if (!parsed.success) { setMessage(parsed.error.issues.map(issue => issue.message).join(" · ")); setError(true); return; }
      setBusy(true); setMessage("");
      try {
        const result = await api<BusinessSettingsResult>("PATCH", "/settings/business", { id:"entity_identity", expected_version:saved.versions.entity_identity, value:parsed.data });
        setSaved(result); setDraft(result.settings.entity_identity ?? defaultEntityIdentitySettings); setConflict(false);
        setPersistedSourceCount((result.settings.entity_identity ?? defaultEntityIdentitySettings).sources.length);
        setMessage("식별자 설정을 저장했습니다."); setError(false);
      } catch (cause) { setConflict(cause instanceof ApiError && cause.status === 409); setMessage(cause instanceof Error ? cause.message : "저장하지 못했습니다. 입력은 유지했습니다."); setError(true); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy||reading} className="form plain-fieldset">
        <div className="field-row">
          <Field label="식별자 발급 방식">{props => <select {...props} className="input" value={draft.generation} onChange={event => setDraft(current => current && ({ ...current, generation:event.target.value as IdentitySettings["generation"] }))}><option value="uuid">UUID 자동 발급</option><option value="manual">직접 입력</option></select>}</Field>
          <Field label="기본 발급처">{props => <select {...props} className="input" value={draft.default_source} onChange={event => setDraft(current => current && ({ ...current, default_source:event.target.value }))}>{active.map(source => <option key={source.code} value={source.code}>{source.label || source.code} ({source.code})</option>)}</select>}</Field>
        </div>
        <div className="settings-source-heading"><h3>발급처 ({active.length}개)</h3><BodyAction icon="create" disabled={draft.sources.length >= 32} onClick={() => setDraft(current => current && ({ ...current, sources:[...current.sources, {code:"",label:""}] }))}>추가</BodyAction></div>
        <div className="settings-source-list">{draft.sources.map((source, index) => !source.deleted && <div className="settings-source-row" key={index}>
          <div className="settings-source-fields">
            <input aria-label={`발급처 ${index + 1} 표시 이름`} className="input" placeholder="표시 이름" value={source.label} onChange={event => changeSource(index, {label:event.target.value})} />
            {isSavedSource(index) ? <span className="settings-source-code">{source.code}{draft.default_source === source.code ? " · 기본" : ""}</span> : <input aria-label={`발급처 ${index + 1} 코드`} className="input" placeholder="코드 (crm)" value={source.code} onChange={event => changeSource(index, {code:event.target.value})} />}
          </div>
          <BodyAction aria-label={`${source.label || "새 발급처"} 삭제`} disabled={active.length <= 1} title={active.length <= 1 ? "활성 발급처는 하나 이상 필요합니다" : undefined} onClick={() => removeSource(index)}>삭제</BodyAction>
        </div>)}</div>
        {retired.length > 0 && <details className="settings-source-retired"><summary>삭제된 발급처 ({retired.length}개)</summary>{draft.sources.map((source, index) => source.deleted && <div className="settings-source-row" key={source.code}>
          <div className="settings-source-fields"><span>{source.label}</span><span className="settings-source-code">{source.code}</span></div><BodyAction aria-label={`${source.label} 복원`} onClick={() => changeSource(index,{deleted:false})}>복원</BodyAction>
        </div>)}</details>}
        {conflict && <button type="button" className="btn" onClick={() => void read()}>{reading ? "확인 중…" : "최신값 확인"}</button>}
        <div className="settings-section-footer"><div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={() => {setDraft(savedIdentity);setPersistedSourceCount(savedIdentity.sources.length);setConflict(false);setMessage("");}}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy ? "저장 중…" : "식별자 설정 저장"}</button></div></div>
      </fieldset>
    </form>}
  </section>;
}
