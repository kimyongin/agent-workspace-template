import { useEffect, useState } from "react";
import { defaultEntityIdentitySettings, entityIdentitySettings, type EntityIdentitySettings as IdentitySettings } from "@contracts/entity-identity.ts";
import { api, ApiError } from "../../lib/api.ts";
import { Field, Notice } from "../../components/Field.tsx";

export function EntityIdentitySettings({onStateChange}: {onStateChange?:(state:{dirty:boolean;busy:boolean})=>void}) {
  const [saved, setSaved] = useState<{ version: number; settings: { entity_identity: IdentitySettings } } | null>(null);
  const [draft, setDraft] = useState<IdentitySettings | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const c = new AbortController(); void api<typeof saved>("GET", "/settings/business", undefined, c.signal).then(value => { if (value) { setSaved({...value,settings:{entity_identity:value.settings.entity_identity ?? defaultEntityIdentitySettings}}); setDraft(value.settings.entity_identity ?? defaultEntityIdentitySettings); } }).catch(() => { if (!c.signal.aborted) setMessage("식별자 설정을 불러오지 못했습니다."); }); return () => c.abort(); }, []);
  const dirty = !!saved && JSON.stringify(draft) !== JSON.stringify(saved.settings.entity_identity);
  useEffect(() => { onStateChange?.({dirty,busy}); }, [dirty,busy,onStateChange]);
  const readLatest = async () => { try { const value = await api<NonNullable<typeof saved>>("GET", "/settings/business"); setSaved({...value,settings:{entity_identity:value.settings.entity_identity ?? defaultEntityIdentitySettings}}); setDraft(current => current ?? value.settings.entity_identity ?? defaultEntityIdentitySettings); setMessage("최신 버전을 불러왔습니다. 입력은 유지했습니다."); } catch { setMessage("최신 설정을 불러오지 못했습니다."); } };
  return <section className="settings-group" aria-labelledby="entity-identity-title">
    <h2 className="section-title" id="entity-identity-title">엔터티 식별자</h2>
    {message && <Notice>{message}</Notice>}<button type="button" className="btn" disabled={busy} onClick={() => void readLatest()}>최신 설정 조회</button>
    {draft && <form className="form" aria-label="엔터티 식별자 설정" onSubmit={async event => {
      event.preventDefault(); if (!saved || busy) return;
      const parsed = entityIdentitySettings.safeParse(draft);
      if (!parsed.success) { setMessage(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" · ")); return; }
      setBusy(true);
      try { const result = await api<NonNullable<typeof saved>>("PATCH", "/settings/business", { expected_version: saved.version, sections: { entity_identity: parsed.data } }); setSaved(result); setDraft(result.settings.entity_identity); setMessage("식별자 설정을 저장했습니다."); }
      catch (cause) { setMessage(cause instanceof ApiError ? cause.message : "저장하지 못했습니다. 입력은 유지했습니다."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="form">
        <Field label="새 엔터티 식별자 발급 방식">{p => <select {...p} className="input" value={draft.generation} onChange={e => setDraft(d => d && ({ ...d, generation: e.target.value as IdentitySettings["generation"] }))}><option value="uuid">UUID 자동 발급</option><option value="manual">직접 입력</option></select>}</Field>
        <Field label="기본 발급처">{p => <select {...p} className="input" value={draft.default_source} onChange={e => setDraft(d => d && ({ ...d, default_source: e.target.value }))}>{draft.sources.map(s => <option key={s.code} value={s.code}>{s.label} ({s.code})</option>)}</select>}</Field>
        <p className="secondary">방식과 기본 발급처 변경은 새 등록에 적용합니다. 발급처 코드는 고정되며 표시 이름만 바꿀 수 있습니다.</p>
        {draft.sources.map((source, index) => <Field key={index} label={`발급처 ${source.code || index + 1}`}>{() => <span className="form"><input aria-label={`발급처 ${index + 1} 코드`} className="input" value={source.code} disabled={!!saved?.settings.entity_identity.sources.some(s => s.code === source.code)} onChange={e => setDraft(d => d && ({ ...d, sources: d.sources.map((s, i) => i === index ? { ...s, code: e.target.value } : s) }))}/><input aria-label={`발급처 ${index + 1} 표시 이름`} className="input" value={source.label} onChange={e => setDraft(d => d && ({ ...d, sources: d.sources.map((s, i) => i === index ? { ...s, label: e.target.value } : s) }))}/></span>}</Field>)}
        <button type="button" className="btn" disabled={draft.sources.length >= 32} onClick={() => setDraft(d => d && ({ ...d, sources: [...d.sources, { code: "", label: "" }] }))}>발급처 추가</button>
        <div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={() => saved && setDraft(saved.settings.entity_identity)}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy ? "저장 중…" : "식별자 설정 저장"}</button></div>
      </fieldset>
    </form>}
  </section>;
}
