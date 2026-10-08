import { useEffect, useState } from "react";
import type { EntityResult } from "@contracts/entity.ts";
import { entityRekey } from "@contracts/entity.ts";
import { defaultEntityIdentitySettings, entityPath, type EntityIdentitySettings } from "@contracts/entity-identity.ts";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { fieldErrors } from "../../lib/format.ts";

export function EntityIdentityForm({ entity, onClose, onSaved }: {
  entity: EntityResult; onClose: () => void; onSaved: (entity: EntityResult) => void;
}) {
  const [draft, setDraft] = useState({ source: entity.source, external_id: entity.external_id });
  const [settings, setSettings] = useState<EntityIdentitySettings | null>(null);
  useEffect(() => { const c = new AbortController(); void api<{ settings: { entity_identity: EntityIdentitySettings } }>("GET", "/settings/business", undefined, c.signal).then(value => setSettings(value.settings.entity_identity ?? defaultEntityIdentitySettings)).catch(() => {}); return () => c.abort(); }, []);
  return <FormModal open domain="엔터티" title="식별 정보 변경" submitLabel="변경" dirty={draft.source !== entity.source || draft.external_id !== entity.external_id}
    preparation={() => ({model:"entity",action:"update",operation:"identity",target_id:entity.id,expected_version:entity.version,input:draft})}
    mutation={{ target: entity.prop1, action: "식별 정보 변경" }} onClose={onClose}
    validate={() => { const result = entityRekey.safeParse({ ...draft, expected_version: entity.version }); return result.success ? null : fieldErrors(result.error.issues); }}
    onSubmit={async (_id, memo) => { const saved = await api<EntityResult>("POST", `${entityPath(entity.id)}/identity`, { ...draft, expected_version: entity.version, ...memo }); onSaved(saved); }}>
    {errors => <section className="detail-section form">
      <p className="secondary">모든 할 일·기록·태그와 사건의 연결이 함께 바뀝니다. 과거 본문은 보존합니다.</p>
      <Field label="발급처" required error={errors.source}>{p => <select {...p} className="input" value={draft.source} onChange={e => setDraft(d => ({ ...d, source: e.target.value }))}>
        {settings ? settings.sources.map(s => <option key={s.code} value={s.code}>{s.label} ({s.code})</option>) : <option value={entity.source}>{entity.source_label}</option>}
      </select>}</Field>
      <Field label="외부 식별자" required error={errors.external_id}>{p => <input {...p} className="input" value={draft.external_id} onChange={e => setDraft(d => ({ ...d, external_id: e.target.value }))}/>}</Field>
    </section>}
  </FormModal>;
}
