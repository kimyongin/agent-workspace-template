import { useEffect, useRef, useState } from "react";
import { APP_IDENTIFIER_RULE_ID, type EntityTypeIdentity, type IdentityDefaultType } from "@contracts/entity-issuer.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { Field } from "../../components/Field.tsx";
import { typeIdentityPort } from "./issuer-registry-api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
/** Resolve one blocking default while keeping the original registry draft open. */
export function DefaultIssuerRepair({ type, blockedSource, blockedRule, onSaved, onState }: {
  type: IdentityDefaultType;
  blockedSource: string;
  blockedRule?: string;
  onSaved: () => void;
  onState: (busy: boolean, uncertain: boolean) => void;
}) {
  const choice = useRef<HTMLSelectElement>(null);
  const [identity, setIdentity] = useState<EntityTypeIdentity | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt();
  useEffect(() => {
    onState(busy, uncertain);
  }, [busy, uncertain, onState]);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void typeIdentityPort.read(type.type_id, c.signal).then((row) => {
      if (!c.signal.aborted) {
        setIdentity(row);
        setSource("");
      }
    }).catch((e) => {
      if (!c.signal.aborted) setError(writeErrorMessage(e));
    });
    return () => c.abort();
  }, [type.type_id, revision]);
  useEffect(() => {
    if (identity) choice.current?.focus({ preventScroll: true });
  }, [identity]);
  const sources = identity
    ? [
      ...identity.sources,
      ...(!identity.sources.some((s) => s.code === "app")
        ? [{
          code: "app",
          rule_id: APP_IDENTIFIER_RULE_ID,
          active: true,
          referenced: false,
          source_label: "앱",
          rule_label: "자동 발급",
          generation: "automatic" as const,
        }]
        : []),
    ]
    : [];
  const choices = sources.filter((s) =>
    (s.active || s.code === "app") &&
    (s.code !== blockedSource || blockedRule !== undefined && s.rule_id !== blockedRule)
  );
  const save = async () => {
    if (!identity || !source || busy) return;
    setError("");
    try {
      await attempt.run(async () => {
        await typeIdentityPort.save(
          type.type_id,
          {
            label: identity.label,
            default_source: source,
            expected_version: identity.version,
            sources: sources.filter((s) =>
              identity.sources.some((current) => current.code === s.code) || s.code === source
            )
              .map(({ code, rule_id, active }) => ({ code, rule_id, active: active || code === source })),
          },
          new AbortController().signal,
          attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      setError(writeErrorMessage(e));
    }
  };
  return (
    <div className="settings-fields">
      {error && <p role="alert" className="error-text">{error}</p>}
      {!identity && !error && <p role="status">불러오는 중…</p>}
      {identity && (
        <Field label={`${type.label} 기본 발급처`}>
          {(props) => (
            <select
              {...props}
              ref={choice}
              className="input"
              value={source}
              disabled={busy || uncertain}
              onChange={(e) => {
                setSource(e.target.value);
                attempt.reset();
              }}
            >
              <option value="">선택하세요</option>
              {choices.map((s) => <option key={s.code} value={s.code}>{s.source_label} · {s.rule_label}</option>)}
            </select>
          )}
        </Field>
      )}
      {identity && choices.length === 0 && (
        <p role="status">다른 활성 발급처가 없습니다. 자료 설정에서 발급처를 연결한 뒤 다시 시도하세요.</p>
      )}
      <div className="settings-inline-actions">
        <BodyAction disabled={!source || busy} onClick={() => void save()}>
          {uncertain ? "같은 요청 다시 확인" : busy ? "저장 중…" : "기본 발급처 변경"}
        </BodyAction>
        {error && !uncertain && (
          <BodyAction
            disabled={busy}
            onClick={() => {
              setIdentity(null);
              attempt.reset();
              setRevision((v) => v + 1);
            }}
          >
            다시 조회
          </BodyAction>
        )}
      </div>
    </div>
  );
}
