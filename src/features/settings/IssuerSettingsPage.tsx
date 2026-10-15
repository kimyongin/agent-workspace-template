import { useEffect, useRef, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { BodyAction, BodyActionFace } from "../../components/BodyAction.tsx";
import { SettingsHeading } from "./SettingsHeading.tsx";
import { IssuerEditModal, type RegistryEditTarget } from "./IssuerEditModal.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { issuerRegistry } from "./issuer-registry-api.ts";
import "./settings.css";

export function IssuerSettingsPage() {
  const [issuers, setIssuers] = useState<EntityIssuer[] | null>(null), [selected, setSelected] = useState("");
  const [rules, setRules] = useState<IdentifierRule[] | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [ruleError, setRuleError] = useState("");
  const [revision, setRevision] = useState(0), [ruleRevision, setRuleRevision] = useState(0);
  const [editing, setEditing] = useState<RegistryEditTarget | null>(null), [message, setMessage] = useState("");
  const addButton = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const rulesRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    void issuerRegistry.list(c.signal).then((result) => {
      if (!c.signal.aborted) setIssuers(result.items);
    }).catch((e) => {
      if (!c.signal.aborted) setError(e instanceof Error ? e.message : "발급처를 읽지 못했습니다.");
    }).finally(() => {
      if (!c.signal.aborted) setLoading(false);
    });
    return () => c.abort();
  }, [revision]);
  useEffect(() => {
    const c = new AbortController();
    rulesRequest.current = c;
    setRules(null);
    setRuleError("");
    if (selected) {
      void issuerRegistry.rules(selected, c.signal).then((result) => {
        if (!c.signal.aborted) setRules(result.items);
      }).catch((e) => {
        if (!c.signal.aborted) setRuleError(e instanceof Error ? e.message : "번호 종류를 읽지 못했습니다.");
      });
    }
    return () => c.abort();
  }, [selected, ruleRevision]);
  useEffect(() => {
    if (!editing && returnFocus.current) {
      const frame = requestAnimationFrame(() => {
        const target = returnFocus.current;
        if (target?.isConnected) target.focus();
        else addButton.current?.focus();
        returnFocus.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editing]);
  const edit = (target: RegistryEditTarget) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setEditing(target);
    setMessage("");
  };
  const saved = (row: EntityIssuer | IdentifierRule) => {
    if ("code" in row) {
      setIssuers((current) =>
        current?.some((i) => i.code === row.code)
          ? current.map((i) => i.code === row.code ? row : i)
          : [...(current ?? []), row]
      );
      setSelected(row.code);
      setMessage("발급처를 저장했습니다.");
      if (editing?.kind === "issuer" && !editing.issuer) {
        setEditing({ kind: "rule", source: row.code, sourceLabel: row.label, createdIssuer: true });
        return;
      }
    } else {
      rulesRequest.current?.abort();
      setRules((current) =>
        current?.some((r) => r.id === row.id)
          ? current.map((r) => r.id === row.id ? row : r)
          : [...(current ?? []), row]
      );
      setMessage("번호 종류를 저장했습니다.");
    }
    setEditing(null);
  };
  return (
    <section className="panel settings" aria-label="발급처 설정">
      <SettingsHeading title="발급처 설정" description="자료 번호의 발급처와 번호 종류를 관리합니다." />
      <div className="settings-inline-actions">
        <button
          type="button"
          className="body-action"
          ref={addButton}
          disabled={loading}
          onClick={() => edit({ kind: "issuer" })}
        >
          <BodyActionFace icon="create">발급처 추가</BodyActionFace>
        </button>
      </div>
      {loading && <p role="status">불러오는 중…</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          <BodyAction icon="reset" onClick={() => setRevision((v) => v + 1)}>다시 조회</BodyAction>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {issuers?.length === 0 && !loading && !error && <p className="secondary">발급처가 없습니다.</p>}
      <div className="issuer-registry-list">
        {issuers?.map((issuer) => (
          <IssuerRow
            key={issuer.code}
            label={issuer.label}
            open={selected === issuer.code}
            summary={!issuer.active ? "사용 중지" : issuer.system ? "자동 발급" : undefined}
            onToggle={() => {
              setSelected((value) => value === issuer.code ? "" : issuer.code);
              setMessage("");
            }}
          >
            {!issuer.system && (
              <div className="issuer-entry-actions">
                <BodyAction aria-label={`${issuer.label} 편집`} onClick={() => edit({ kind: "issuer", issuer })}>
                  발급처 편집
                </BodyAction>
              </div>
            )}
            {selected === issuer.code && (
              <>
                <div className="settings-source-heading">
                  <h3 className="label">번호 종류</h3>
                  {!issuer.system && (
                    <BodyAction
                      icon="create"
                      disabled={rules === null || !issuer.active}
                      onClick={() => edit({ kind: "rule", source: issuer.code, sourceLabel: issuer.label })}
                    >
                      번호 종류 추가
                    </BodyAction>
                  )}
                </div>
                {rules === null && !ruleError && <p role="status">불러오는 중…</p>}
                {ruleError && (
                  <div className="notice notice-error" role="alert">
                    {ruleError}
                    <BodyAction icon="reset" onClick={() => setRuleRevision((v) => v + 1)}>다시 조회</BodyAction>
                  </div>
                )}
                {rules?.length === 0 && <p className="secondary">등록된 번호 종류가 없습니다.</p>}
                <div className="issuer-rule-list">
                  {rules?.map((rule) => {
                    const generation = rule.generation === "automatic" ? "자동 발급" : "직접 입력";
                    const summary = [rule.label === generation ? "" : generation, rule.active ? "" : "사용 중지"]
                      .filter(Boolean).join(" · ");
                    return (
                      <div key={rule.id} className="issuer-rule-row">
                        <div>
                          <span className="item-title">{rule.label}</span>
                          {summary && <span className="secondary">{summary}</span>}
                        </div>
                        {!issuer.system && (
                          <BodyAction
                            aria-label={`${rule.label} 편집`}
                            onClick={() => edit({ kind: "rule", source: issuer.code, sourceLabel: issuer.label, rule })}
                          >
                            편집
                          </BodyAction>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </IssuerRow>
        ))}
      </div>
      {editing && (
        <IssuerEditModal
          key={editing.kind === "issuer"
            ? `issuer:${editing.issuer?.code ?? "new"}`
            : `rule:${editing.source}:${editing.rule?.id ?? "new"}`}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onDeleted={() => {
            if (editing.kind === "issuer") { setSelected(""); setRevision(v => v + 1); }
            else setRuleRevision(v => v + 1);
            setEditing(null); setMessage("삭제했습니다.");
          }}
        />
      )}
    </section>
  );
}
