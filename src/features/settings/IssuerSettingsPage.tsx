import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { Field } from "../../components/Field.tsx";
import { IssuerEditModal, type RegistryEditTarget } from "./IssuerEditModal.tsx";
import { issuerRegistry } from "./issuer-registry-api.ts";
import { type MaterialSectionState, MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import "./settings.css";
export function IssuerSettingsPage() {
  const [issuers, setIssuers] = useState<EntityIssuer[] | null>(null),
    [selected, setSelected] = useState(""),
    [rules, setRules] = useState<IdentifierRule[] | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<RegistryEditTarget | null>(null),
    [editState, setEditState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const report = useCallback((state: MaterialSectionState) => setEditState(state), []);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await issuerRegistry.list(signal);
      if (!signal?.aborted && mounted.current) {
        setIssuers(result.items);
        setRevision((value) => value + 1);
        setSelected((value) => value || result.items.find((i) => i.system)?.code || result.items[0]?.code || "");
      }
    } catch (e) {
      if (!signal?.aborted && mounted.current) setError(e instanceof Error ? e.message : "발급처를 읽지 못했습니다.");
    } finally {
      if (!signal?.aborted && mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const c = new AbortController();
    void refresh(c.signal);
    return () => {
      c.abort();
    };
  }, [refresh]);
  useEffect(() => {
    const c = new AbortController();
    setRules(null);
    if (selected) {
      void issuerRegistry.rules(selected, c.signal).then((result) => {
        if (!c.signal.aborted) setRules(result.items);
      }).catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    }
    return () => c.abort();
  }, [selected, revision]);
  const issuer = issuers?.find((i) => i.code === selected);
  const saved = (row: EntityIssuer | IdentifierRule) => {
    if ("code" in row) {
      setIssuers((current) =>
        [...(current ?? []).filter((i) => i.code !== row.code), row].sort((a, b) => a.code.localeCompare(b.code))
      );
      setSelected(row.code);
    } else setRules((current) => [...(current ?? []).filter((r) => r.id !== row.id), row]);
    setEditing(null);
    setEditState({ dirty: false, busy: false });
    setMessage("설정을 저장했습니다.");
  };
  return (
    <section className="panel settings" aria-label="발급처 설정">
      <h1 className="page-title">발급처 설정</h1>
      <div className="material-settings-toolbar">
        <Field label="발급처">
          {(props) => (
            <select
              {...props}
              className="input"
              value={selected}
              disabled={loading || !!editing}
              onChange={(e) => {
                setSelected(e.target.value);
                setError("");
                setMessage("");
              }}
            >
              {!selected && <option value="">발급처 선택</option>}
              {selected && !issuer && <option value={selected}>조회할 수 없는 발급처</option>}
              {issuers?.map((i) => <option key={i.code} value={i.code}>{i.label}{i.active ? "" : " (중지)"}</option>)}
            </select>
          )}
        </Field>
        <BodyAction icon="create" disabled={!!editing || loading} onClick={() => setEditing({ kind: "issuer" })}>
          발급처 추가
        </BodyAction>
      </div>
      {loading && <p role="status">불러오는 중…</p>}
      {error && (
        <p className="error-text" role="alert">
          {error} <button className="btn" type="button" onClick={() => void refresh()}>다시 조회</button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {issuers?.length === 0 && !loading && !error && (
        <p className="secondary">발급처를 추가하면 자료 종류에서 번호 규칙을 연결할 수 있습니다.</p>
      )}
      {issuer && (
        <>
          <MaterialSettingsSection
            key={`${selected}:basic`}
            title="기본 정보"
            state={editing?.kind === "issuer" ? editState : undefined}
            summary={issuer.active ? "사용 중" : "중지"}
            initialOpen
          >
            <div className="settings-inline-actions">
              <span className="secondary">{issuer.system ? "기본 제공" : ""}</span>
              {!issuer.system && <BodyAction onClick={() => setEditing({ kind: "issuer", issuer })}>편집</BodyAction>}
            </div>
          </MaterialSettingsSection>
          <MaterialSettingsSection
            key={`${selected}:rules`}
            title="번호 규칙"
            state={editing?.kind === "rule" ? editState : undefined}
            initialOpen
          >
            <div className="settings-inline-actions">
              {!issuer.system && (
                <BodyAction
                  icon="create"
                  disabled={!!editing || rules === null}
                  onClick={() => setEditing({ kind: "rule", source: issuer.code })}
                >
                  규칙 추가
                </BodyAction>
              )}
            </div>
            {rules === null && !error && <p role="status">규칙을 읽는 중…</p>}
            {rules?.length === 0 && <p className="secondary">번호 규칙이 없습니다.</p>}
            <div className="issuer-rule-list">
              {rules?.map((rule) => (
                <div key={rule.id} className="issuer-rule-row">
                  <div>
                    <span className="item-title">{rule.label}</span>
                    <span className="secondary">
                      {rule.generation === "automatic" ? "자동 발급" : "직접 입력"}
                      {rule.active ? "" : " · 중지"}
                    </span>
                  </div>
                  {!issuer.system && (
                    <BodyAction
                      aria-label={`${rule.label} 편집`}
                      onClick={() => setEditing({ kind: "rule", source: issuer.code, rule })}
                    >
                      편집
                    </BodyAction>
                  )}
                </div>
              ))}
            </div>
          </MaterialSettingsSection>
        </>
      )}
      {editing && (
        <IssuerEditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onState={report}
        />
      )}
    </section>
  );
}
