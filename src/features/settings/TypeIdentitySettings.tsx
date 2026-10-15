import { IssuerEditModal, type RegistryEditTarget } from "./IssuerEditModal.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { typeIdentityUpdate } from "@contracts/entity-issuer.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { Field } from "../../components/Field.tsx";
import { writeErrorMessage } from "../../lib/write-attempt.ts";
import { issuerRegistry, typeIdentityPort } from "./issuer-registry-api.ts";
import { typeIdentitySettingsAdapter } from "./type-identity-settings.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { type MaterialSectionState, MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { IdentitySourceModal } from "./IdentitySourceModal.tsx";
export function TypeIdentitySettings(
  { typeId, disabled = false, onState }: {
    typeId: string;
    disabled?: boolean;
    onState: (state: MaterialSectionState) => void;
  },
) {
  const adapter = useMemo(() => typeIdentitySettingsAdapter(typeId, typeIdentityPort), [typeId]);
  const editor = useSettingsDraft(adapter), { saved, draft, dirty, busy, uncertain, conflict, latestReady } = editor;
  const [issuers, setIssuers] = useState<EntityIssuer[]>([]),
    [rules, setRules] = useState<Record<string, IdentifierRule[]>>({}),
    [catalogError, setCatalogError] = useState("");
  const [connecting, setConnecting] = useState(false),
    [modalState, setModalState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const [registryEdit, setRegistryEdit] = useState<RegistryEditTarget | null>(null),
    [registryState, setRegistryState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const reportRegistry = useCallback((state: MaterialSectionState) => setRegistryState(state), []);
  const [message, setMessage] = useState(""), [inputError, setInputError] = useState("");
  const reportModal = useCallback((state: MaterialSectionState) => setModalState(state), []);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setCatalogError("");
    void issuerRegistry.list(c.signal).then(async (result) => {
      if (c.signal.aborted) return;
      setIssuers(result.items);
      const definitions = await Promise.all(
        (saved?.sources.map((source) => source.code) ?? []).map(async (code) =>
          [code, (await issuerRegistry.rules(code, c.signal)).items] as const
        ),
      );
      if (!c.signal.aborted) setRules((current) => ({ ...current, ...Object.fromEntries(definitions) }));
    }).catch((e) => {
      if (!c.signal.aborted) setCatalogError(e.message);
    });
    return () => c.abort();
  }, [saved, catalogRevision]);
  const state = {
    dirty: dirty || conflict || modalState.dirty || registryState.dirty,
    busy: busy && editor.operation === "save" || modalState.busy || registryState.busy,
    uncertain: uncertain || modalState.uncertain || registryState.uncertain,
    error: !!editor.error || !!inputError,
  };
  useEffect(() => {
    onState(state);
  }, [state.dirty, state.busy, state.uncertain, state.error, onState]);
  const update = (fn: (value: typeof draft) => typeof draft) => {
    setMessage("");
    setInputError("");
    editor.resource.edit(fn);
  };
  const sourceName = (code: string) =>
    issuers.find((i) => i.code === code)?.label ?? saved?.sources.find((s) => s.code === code)?.source_label ??
      "조회할 수 없는 발급처";
  const isAvailable = (code: string, ruleId: string) => {
    const issuer = issuers.find((i) => i.code === code);
    const rule = rules[code]?.find((r) => r.id === ruleId);
    return issuer
      ? issuer.active &&
        (rule?.active ?? saved?.sources.find((s) => s.code === code && s.rule_id === ruleId)?.active ?? false)
      : saved?.sources.find((s) => s.code === code && s.rule_id === ruleId)?.active ?? false;
  };
  const active = draft.sources.filter((s) => s.active && isAvailable(s.code, s.rule_id));
  const save = async () => {
    setMessage("");
    setInputError("");
    if (!saved) return;
    const parsed = typeIdentityUpdate.safeParse({ ...draft, expected_version: saved.version });
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? "설정 입력을 확인하세요.");
      return;
    }
    if (await editor.resource.save()) setMessage("식별자 설정을 저장했습니다.");
  };
  const error = conflict
    ? "같은 식별자 설정이 변경되었습니다. 입력을 유지했습니다. 최신 저장값을 확인하고 비교하세요."
    : editor.error
    ? writeErrorMessage(editor.error)
    : inputError;
  return (
    <MaterialSettingsSection title="식별자" summary={saved?.label} state={state}>
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!saved && (
        <>
          {busy ? <p role="status">불러오는 중…</p> : (
            <button
              type="button"
              className="btn"
              onClick={() => void editor.resource.read()}
            >
              식별자 설정 다시 조회
            </button>
          )}
        </>
      )}
      {saved && (
        <form
          className="form"
          aria-label="식별자 설정"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {conflict && (
            <div className="settings-inline-actions">
              <button
                className="btn"
                type="button"
                disabled={busy || uncertain}
                onClick={() => void editor.resource.read()}
              >
                최신 저장값 확인
              </button>
              {latestReady && (
                <>
                  <p className="secondary">
                    최신 저장값: {saved.label} · 기본 발급처 {sourceName(saved.default_source)} ·{" "}
                    {saved.sources.filter((s) => s.active).map((s) => s.source_label).join(", ")}
                  </p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      editor.resource.acceptLatest();
                      setInputError("");
                    }}
                  >
                    입력 유지하고 최신 버전 사용
                  </button>
                </>
              )}
            </div>
          )}
          <fieldset className="settings-fields" disabled={busy || uncertain || disabled}>
            <Field label="이름" required>
              {(props) => (
                <input
                  {...props}
                  className="input"
                  required
                  value={draft.label}
                  onChange={(e) => update((v) => ({ ...v, label: e.target.value }))}
                />
              )}
            </Field>
            <Field label="기본 발급처">
              {(props) => (
                <select
                  {...props}
                  className="input"
                  value={draft.default_source}
                  onChange={(e) => update((v) => ({ ...v, default_source: e.target.value }))}
                >
                  {!active.some((s) => s.code === draft.default_source) && (
                    <option value={draft.default_source}>{sourceName(draft.default_source)} (사용 중지)</option>
                  )}
                  {active.map((s) => <option key={s.code} value={s.code}>{sourceName(s.code)}</option>)}
                </select>
              )}
            </Field>
            <div className="settings-source-heading">
              <h3 className="label">지원 발급처</h3>
              <BodyAction icon="link" disabled={!!catalogError} onClick={() => setConnecting(true)}>연결</BodyAction>
            </div>
            {catalogError && (
              <p className="error-text" role="alert">
                발급처·규칙을 읽지 못했습니다. {catalogError}{" "}
                <button type="button" className="btn" onClick={() => setCatalogRevision((value) => value + 1)}>
                  발급처·규칙 다시 조회
                </button>
              </p>
            )}
            <div className="issuer-binding-list">
              {draft.sources.map((source) => {
                const metadata = saved.sources.find((s) => s.code === source.code),
                  issuer = issuers.find((i) => i.code === source.code),
                  options = rules[source.code]?.filter((r) => r.active || r.id === source.rule_id) ?? [],
                  rule = rules[source.code]?.find((r) => r.id === source.rule_id),
                  locked = metadata?.referenced || issuer?.system || source.code === "app",
                  available = isAvailable(source.code, source.rule_id);
                return (
                  <div key={source.code} className="issuer-binding-row">
                    <label className="issuer-status-choice">
                      <input
                        type="checkbox"
                        checked={source.active}
                        disabled={!available && !source.active}
                        onChange={(e) =>
                          update((v) => ({
                            ...v,
                            sources: v.sources.map((s) =>
                              s.code === source.code ? { ...s, active: e.target.checked } : s
                            ),
                          }))}
                      />
                      {sourceName(source.code)}
                    </label>
                    <div>
                      {locked || options.length <= 1
                        ? (
                          <span>
                            {source.code === "app" ? "자동 발급" : rule?.label ?? metadata?.rule_label ?? "번호 규칙"}
                            {metadata?.referenced && (
                              <span className="secondary" aria-label="참조된 규칙 · 변경 불가">· 변경 불가</span>
                            )}
                          </span>
                        )
                        : (
                          <select
                            className="input"
                            aria-label={`${sourceName(source.code)} 번호 규칙`}
                            value={source.rule_id}
                            onChange={(e) =>
                              update((v) => ({
                                ...v,
                                sources: v.sources.map((s) =>
                                  s.code === source.code ? { ...s, rule_id: e.target.value } : s
                                ),
                              }))}
                          >
                            {options.map((r) => (
                              <option key={r.id} value={r.id}>{r.label}{r.active ? "" : " (중지)"}</option>
                            ))}
                          </select>
                        )}
                      {!available && <span className="secondary">· 사용 중지</span>}
                      {issuer && !issuer.system && (
                        <div className="settings-inline-actions">
                          <BodyAction
                            aria-label={`${sourceName(source.code)} 편집`}
                            onClick={() => setRegistryEdit({ kind: "issuer", issuer })}
                          >
                            편집
                          </BodyAction>
                          {!metadata?.referenced && (
                            <BodyAction
                              icon="create"
                              aria-label={`${sourceName(source.code)} 번호 규칙 추가`}
                              disabled={!rules[source.code]}
                              onClick={() => setRegistryEdit({ kind: "rule", source: source.code })}
                            >
                              규칙 추가
                            </BodyAction>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="settings-section-footer">
            <div className="actions">
              <button
                className="btn"
                type="button"
                disabled={busy || uncertain || disabled || (!dirty && !conflict) || conflict && !latestReady}
                onClick={() => {
                  editor.resource.reset();
                  setMessage("");
                  setInputError("");
                }}
              >
                변경 취소
              </button>
              <button className="btn btn-primary" disabled={busy || disabled || conflict || (!dirty && !uncertain)}>
                {busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : "식별자 저장"}
              </button>
            </div>
          </div>
        </form>
      )}
      {registryEdit && (
        <IssuerEditModal
          target={registryEdit}
          onClose={() => setRegistryEdit(null)}
          onState={reportRegistry}
          onSaved={(row) => {
            if ("code" in row) {
              setIssuers((current) => [...current.filter((s) => s.code !== row.code), row]);
            } else {setRules((current) => ({
                ...current,
                [row.source]: [...(current[row.source] ?? []).filter((r) => r.id !== row.id), row],
              })
              );}
            setRegistryEdit(null);
            void editor.resource.read();
          }}
        />
      )}
      {connecting && (
        <IdentitySourceModal
          issuers={issuers}
          linked={draft.sources.map((s) => s.code)}
          onClose={() => setConnecting(false)}
          onIssuer={(source) => setIssuers((current) => [...current.filter((s) => s.code !== source.code), source])}
          onRule={(rule) =>
            setRules((current) => ({
              ...current,
              [rule.source]: [...(current[rule.source] ?? []).filter((r) => r.id !== rule.id), rule],
            }))}
          onState={reportModal}
          onConnect={(issuer, rule) => {
            setRules((current) => ({
              ...current,
              [rule.source]: [...(current[rule.source] ?? []).filter((r) => r.id !== rule.id), rule],
            }));
            update((value) => ({
              ...value,
              sources: [...value.sources, { code: issuer.code, rule_id: rule.id, active: true }],
            }));
            setConnecting(false);
          }}
        />
      )}
    </MaterialSettingsSection>
  );
}
