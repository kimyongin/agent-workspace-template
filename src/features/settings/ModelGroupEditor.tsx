import { useEffect, useRef, useState } from "react";
import type { ModelChange } from "@contracts/data-model.ts";
import type { MigrationPlan } from "@contracts/entity-schema-change.ts";
import { api, ApiError } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { migrationNumericValues } from "./numeric-drafts.ts";

type GroupChild = NonNullable<ModelChange["group"]>["children"][number];
type GroupChange = ModelChange;
export type ModelGroupState = { dirty: boolean; busy: boolean; uncertain: boolean };
const activeStatuses = ["analyzing", "queued", "preparing", "ready_to_commit", "committing"];
export function isModelGroup(change: ModelChange) {
  return !!change.group || change.review.items.some((item) => item.kind === "migration_required");
}
function childrenFor(change: GroupChange): GroupChild[] {
  if (change.group?.children.length) return change.group.children;
  return change.review.items.filter((item) => item.kind === "migration_required" && item.schema && item.current_schema)
    .map((item) => ({
      type_ref: item.ref,
      source: { schema: item.current_schema! },
      change: {
        id: `${change.id}:${item.ref}`,
        type_id: change.review.mapping.types[item.ref],
        source_schema_version: item.current_schema_version ?? 1,
        source_template_fingerprint: "",
        version: 1,
        status: "draft",
        change_kind: "migration_required",
        edits: [],
        migration: { rules: [], overrides: [] },
        executable: false,
        reservations: {},
        target: { schema: item.schema! },
        diff: item.diff,
        fingerprint: "",
        analysis: null,
        created_at: change.created_at,
        updated_at: change.created_at,
      },
    }));
}
export function ModelGroupEditor({ change, onChange, onState, disabled }: {
  change: GroupChange;
  onChange: (change: GroupChange) => void;
  onState: (id: string, state: ModelGroupState) => void;
  disabled: boolean;
}) {
  const children = childrenFor(change);
  const [drafts, setDrafts] = useState<Record<string, MigrationPlan>>({});
  const [accepted, setAccepted] = useState<Record<string, MigrationPlan>>({});
  const [open, setOpen] = useState<string | null>(children[0]?.type_ref ?? null);
  const [error, setError] = useState(""), [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false), [pollRevision, setPollRevision] = useState(0);
  const [pending, setPending] = useState(""), [notice, setNotice] = useState("");
  const { attempt, busy, uncertain } = useWriteAttempt();
  const alive = useRef(true), current = useRef({ onChange, onState });
  current.current = { onChange, onState };
  const readEpoch = useRef(0);
  const active = activeStatuses.includes(change.status);
  const editable = ["needs_conversion", "ready", "failed"].includes(change.status);
  const dirty = children.some((child) =>
    JSON.stringify(drafts[child.type_ref] ?? child.change.migration) !==
      JSON.stringify(accepted[child.type_ref] ?? child.change.migration)
  );
  const locked = disabled || busy || uncertain;
  useEffect(() => {
    current.current.onState(change.id, { dirty, busy, uncertain });
  }, [change.id, dirty, busy, uncertain]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      current.current.onState(change.id, { dirty: false, busy: false, uncertain: false });
    };
  }, [change.id]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const epoch = ++readEpoch.current;
      try {
        const value = await api<GroupChange>("GET", `/data-model/changes/${change.id}`, undefined, controller.signal);
        if (controller.signal.aborted || epoch !== readEpoch.current) return;
        setReadError("");
        current.current.onChange(value);
        if (activeStatuses.includes(value.status)) timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!controller.signal.aborted && epoch === readEpoch.current) {
          setReadError(e instanceof ApiError ? e.message : "진행 상태를 읽지 못했습니다.");
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [change.id, active, pollRevision]);
  const refresh = async () => {
    const epoch = ++readEpoch.current;
    setReading(true);
    setReadError("");
    try {
      const value = await api<GroupChange>("GET", `/data-model/changes/${change.id}`);
      if (alive.current && epoch === readEpoch.current) {
        current.current.onChange(value);
        setPollRevision((value) => value + 1);
      }
    } catch (e) {
      if (alive.current && epoch === readEpoch.current) {
        setReadError(e instanceof ApiError ? e.message : "진행 상태를 읽지 못했습니다.");
      }
    } finally {
      if (alive.current) setReading(false);
    }
  };
  const perform = async (action: string) => {
    if (disabled || busy || uncertain && pending !== action) return;
    let conversions: { type_ref: string; migration: MigrationPlan }[] = [];
    try {
      if (action === "analyze") {
        conversions = children.map((child) => ({
          type_ref: child.type_ref,
          migration: migrationNumericValues(child.change.target, drafts[child.type_ref] ?? child.change.migration),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "보완 입력을 확인하세요.");
      return;
    }
    const payload = { expected_version: change.version, ...(action === "analyze" ? { conversions } : {}) };
    setPending(action);
    setError("");
    setNotice("");
    try {
      await attempt.run(async () => {
        const value = await api<GroupChange>(
          "POST",
          `/data-model/changes/${change.id}/${action}`,
          payload,
          undefined,
          attempt.requestKey(),
        );
        if (!alive.current) return;
        readEpoch.current++;
        if (action === "analyze") {
          const saved = Object.fromEntries(conversions.map((item) => [item.type_ref, item.migration]));
          setAccepted(saved);
          setDrafts(saved);
        }
        if (action === "cancel") {
          setDrafts({});
          setAccepted({});
        }
        current.current.onChange(value);
        setNotice(
          action === "analyze"
            ? "변경 영향 확인을 접수했습니다."
            : action === "apply"
            ? "자료 값 변환을 요청했습니다. 완료 전에는 현재 설정을 유지합니다."
            : action === "cancel"
            ? "변경 취소 결과를 확인했습니다."
            : "같은 값 변환 작업을 다시 접수했습니다.",
        );
        void refresh();
      });
    } catch (e) {
      if (alive.current) setError(writeErrorMessage(e));
    }
  };
  return (
    <section aria-label="기존 자료 값 변환" className="settings-fields">
      {notice && !["applied", "cancelled"].includes(change.status) && <p role="status">{notice}</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {readError && (
        <div role="alert">
          <p className="error-text">{readError} 접수된 작업은 유지됩니다.</p>
          <button className="btn" disabled={busy || reading} onClick={() => void refresh()}>진행 상태 다시 조회</button>
        </div>
      )}
      {change.group && (
        <p role="status">
          전체 {change.group.total}개 · 처리 {change.group.processed}개 · 실패 {change.group.failed}개
        </p>
      )}
      {change.group?.failure_reason && <p role="alert" className="error-text">{change.group.failure_reason}</p>}
      {active && (
        <p className="help">
          요청한 작업을 진행하고 있습니다. 처리 중에는 값 변환 방법을 수정할 수 없습니다. 화면을 다시 열어도 진행 상태를 확인할 수 있습니다.
        </p>
      )}
      <div className="issuer-registry-list">
        {children.map((child) => (
          <IssuerRow
            key={child.type_ref}
            label={`${change.review.items.find((item) => item.ref === child.type_ref)?.label ?? "자료"} 변환`}
            summary={child.change.analysis
              ? `대상 ${child.change.analysis.total}개 · 실패 ${child.change.analysis.failed}개`
              : "분석 전"}
            open={open === child.type_ref}
            onToggle={() => setOpen(open === child.type_ref ? null : child.type_ref)}
          >
            <ConversionEditor
              plan={child.change}
              sourceDefinition={child.source}
              migration={drafts[child.type_ref] ?? child.change.migration}
              disabled={locked || !editable}
              onChange={(migration) => {
                if (!locked && editable) setDrafts((drafts) => ({ ...drafts, [child.type_ref]: migration }));
              }}
            />
          </IssuerRow>
        ))}
      </div>
      {dirty && <p role="status">수정한 값 변환 방법을 아직 저장하지 않았습니다. 변경 영향 확인을 눌러 저장하고 다시 확인하세요.</p>}
      <div className="actions schema-actions">
        {uncertain
          ? (
            <button className="btn btn-primary" disabled={disabled || busy} onClick={() => void perform(pending)}>
              같은 요청 다시 확인
            </button>
          )
          : (
            <>
              {editable && (
                <button
                  className={`btn${
                    change.status === "needs_conversion" || dirty ||
                      change.status === "failed" && !change.group?.retryable
                      ? " btn-primary"
                      : ""
                  }`}
                  disabled={locked || !children.length}
                  onClick={() => void perform("analyze")}
                >
                  {busy ? "접수 중…" : "변경 영향 확인"}
                </button>
              )}
              {change.status === "ready" && (
                <button
                  className="btn btn-primary"
                  disabled={locked || dirty || !!change.group?.failed}
                  onClick={() => void perform("apply")}
                >
                  검토한 설정 적용
                </button>
              )}
              {change.status === "failed" && change.group?.retryable && (
                <button
                  className="btn btn-primary"
                  disabled={locked || dirty}
                  onClick={() => void perform("retry")}
                >
                  값 변환 다시 시도
                </button>
              )}
              {!["applied", "cancelled", "committing"].includes(change.status) && (
                <button
                  className="btn"
                  disabled={locked}
                  onClick={() => void perform("cancel")}
                >
                  변경 취소
                </button>
              )}
            </>
          )}
      </div>
    </section>
  );
}
