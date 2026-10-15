import { useEffect, useRef, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { Field } from "../../components/Field.tsx";
import { ConfirmDialog, ModalShell } from "../../components/Modal.tsx";
import { ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { issuerRegistry } from "./issuer-registry-api.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
export type RegistryEditTarget = { kind: "issuer"; issuer?: EntityIssuer } | {
  kind: "rule";
  source: string;
  sourceLabel: string;
  createdIssuer?: boolean;
  rule?: IdentifierRule;
};
export function IssuerEditModal(
  { target, onClose, onSaved, onState }: {
    target: RegistryEditTarget;
    onClose: () => void;
    onSaved: (value: EntityIssuer | IdentifierRule) => void;
    onState?: (state: MaterialSectionState) => void;
  },
) {
  const original = target.kind === "issuer" ? target.issuer : target.rule;
  const [baseline, setBaseline] = useState(original),
    [label, setLabel] = useState(original?.label ?? ""),
    [active, setActive] = useState(original?.active ?? true);
  const [code] = useState(() => `issuer_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<EntityIssuer | IdentifierRule | null>(null),
    [reading, setReading] = useState(false),
    [confirmDisable, setConfirmDisable] = useState(false);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = label !== (baseline?.label ?? "") || active !== (baseline?.active ?? true);
  useEffect(() => {
    onState?.({ dirty: dirty || conflict, busy: busy || reading, uncertain, error: !!error });
  }, [dirty, conflict, busy, reading, uncertain, error, onState]);
  useEffect(() => () => onState?.({ dirty: false, busy: false, uncertain: false }), [onState]);
  const save = async (confirmed = false) => {
    if (busy || reading || conflict || (!dirty && !uncertain)) return;
    if (!label.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (baseline?.active && !active && !confirmed && !uncertain) {
      setConfirmDisable(true);
      return;
    }
    setConfirmDisable(false);
    setError("");
    try {
      await attempt.run(async () => {
        const saved = target.kind === "issuer"
          ? baseline
            ? await issuerRegistry.update((baseline as EntityIssuer).code, {
              label,
              active,
              expected_version: baseline.version,
            }, attempt.requestKey())
            : await issuerRegistry.create({ code, label }, attempt.requestKey())
          : baseline
          ? await issuerRegistry.updateRule((baseline as IdentifierRule).id, {
            label,
            active,
            expected_version: baseline.version,
          }, attempt.requestKey())
          : await issuerRegistry.createRule(target.source, { label, meaning: label }, attempt.requestKey());
        if (mounted.current) onSaved(saved);
      });
    } catch (e) {
      if (!mounted.current) return;
      const blocked = e instanceof ApiError && ["conflict", "settings_changed"].includes(e.code);
      setConflict(blocked);
      setError(blocked ? `${e.message} 입력을 유지했습니다. 최신 저장값을 확인하세요.` : writeErrorMessage(e));
    }
  };
  const readLatest = async () => {
    if (!baseline || busy || uncertain || reading) return;
    setReading(true);
    setError("");
    try {
      const rows = target.kind === "issuer"
        ? (await issuerRegistry.list()).items
        : (await issuerRegistry.rules(target.source)).items;
      const row = rows.find((r) =>
        "code" in r ? r.code === (baseline as EntityIssuer).code : r.id === (baseline as IdentifierRule).id
      );
      if (!row) throw new Error("최신 설정을 찾을 수 없습니다.");
      if (mounted.current) setLatest(row);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "조회하지 못했습니다.");
    } finally {
      if (mounted.current) setReading(false);
    }
  };
  return (
    <ModalShell
      open
      description={target.kind === "issuer"
        ? "자료 번호의 발급처 이름과 코드를 정합니다."
        : "번호의 용도와 발급 방식을 정합니다."}
      title={target.kind === "issuer"
        ? baseline ? "발급처 편집" : "발급처 추가"
        : baseline
        ? "번호 종류 편집"
        : "번호 종류 추가"}
      dirty={dirty || conflict || uncertain}
      busy={busy || reading || uncertain}
      onClose={onClose}
      footer={(requestClose) => (
        <>
          <button className="btn" type="button" disabled={busy || reading || uncertain} onClick={requestClose}>
            {target.kind === "rule" && target.createdIssuer ? "나중에 추가" : "취소"}
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form="registry-edit-form"
            disabled={busy || reading || conflict || (!dirty && !uncertain)}
          >
            {busy
              ? "저장 중…"
              : uncertain
              ? "같은 요청 다시 확인"
              : target.kind === "issuer" && !baseline
              ? "저장하고 번호 추가"
              : "저장"}
          </button>
        </>
      )}
    >
      <form
        id="registry-edit-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {target.kind === "rule" && <p className="item-title">{target.sourceLabel}</p>}
        {target.kind === "rule" && target.createdIssuer && (
          <p role="status" className="secondary">발급처를 저장했습니다.</p>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {conflict && (
          <div className="settings-inline-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || uncertain || reading}
              onClick={() => void readLatest()}
            >
              {reading ? "확인 중…" : "최신 저장값 확인"}
            </button>
            {latest && (
              <>
                <p className="secondary">최신 저장값: {latest.label} · {latest.active ? "사용 중" : "중지"}</p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setBaseline(latest);
                    setLatest(null);
                    setConflict(false);
                    setError("");
                    attempt.reset();
                  }}
                >
                  입력 유지하고 최신 버전 사용
                </button>
              </>
            )}
          </div>
        )}
        <fieldset className="settings-fields" disabled={busy || reading || uncertain}>
          <Field label={target.kind === "issuer" ? "발급처 이름" : "번호 종류 이름"} required>
            {(props) => (
              <input
                {...props}
                className="input"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          {baseline && (
            <label className="issuer-status-choice">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> 사용
            </label>
          )}
        </fieldset>
      </form>
      <ConfirmDialog
        open={confirmDisable}
        title="사용을 중지할까요?"
        message="새 자료 등록에 이 발급처·번호 종류를 사용하지 않게 됩니다."
        confirmLabel="중지하고 저장"
        busy={busy}
        onConfirm={() => void save(true)}
        onCancel={() => setConfirmDisable(false)}
      />
    </ModalShell>
  );
}
