import { materialSettingsPath } from "./material-settings-path.ts";
import { type MaterialSectionState, MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RecoveryAvailability, RecoveryChangeCreate, recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { Link, useLocation, useNavigate } from "react-router";
import type { EntitySchemaMigration, SchemaMigrationAccepted } from "@contracts/entity-schema-migration.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { api } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
const labels: Record<EntitySchemaMigration["status"], string> = {
  queued: "접수",
  preparing: "준비 중",
  ready_to_commit: "적용 준비 완료",
  committing: "적용 중",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소",
};
const active = (job: EntitySchemaMigration) =>
  ["queued", "preparing", "ready_to_commit", "committing"].includes(job.status);
export function MigrationStart(
  { plan, disabled, onState }: {
    plan: EntitySchemaChange;
    disabled: boolean;
    onState?: (state: { busy: boolean; uncertain: boolean }) => void;
  },
) {
  const navigate = useNavigate(), location = useLocation(), { attempt, busy, uncertain } = useWriteAttempt();
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    onState?.({ busy, uncertain });
  }, [busy, uncertain, onState]);
  useLayoutEffect(() => () => onState?.({ busy: false, uncertain: false }), [onState]);
  const acceptedRef = useRef<SchemaMigrationAccepted | undefined>(undefined);
  const start = async () => {
    setError("");

    try {
      await attempt.run(async () => {
        acceptedRef.current = await api<SchemaMigrationAccepted>(
          "POST",
          `/entity-types/${plan.type_id}/schema-changes/${plan.id}/migrations`,
          {
            expected_change_version: plan.version,
            expected_type_version: plan.source_type_version,
            expected_schema_version: plan.source_schema_version,
            analysis_id: plan.analysis!.id,
            fingerprint: plan.fingerprint,
          },
          undefined,
          attempt.requestKey(),
        );
      });
      if (acceptedRef.current) {
        const params = new URLSearchParams(location.search);
        params.set("job_id", acceptedRef.current.job_id);
        params.set("change_id", plan.id);
        requestAnimationFrame(() => {
          navigate(`/settings/entity-types/${plan.type_id}?${params}`);
        });
      }
    } catch (e) {
      setError(plan.recovery ? recoveryErrorMessage(e) : writeErrorMessage(e));
    }
  };
  return (
    <div className="schema-actions">
      <button
        className="btn btn-primary"
        disabled={busy || (!uncertain && (disabled || !plan.executable))}
        onClick={() => void start()}
      >
        {busy ? "접수 중…" : uncertain ? "같은 접수 요청 다시 확인" : "값 변환 실행"}
      </button>
      {error && <p role="alert">{error} 작업 목록에서 접수 여부를 확인할 수 있습니다.</p>}
    </div>
  );
}
export function MigrationJobs({ typeId }: { typeId: string }) {
  const location = useLocation();
  const [list, setList] = useState({
    typeId,
    items: [] as EntitySchemaMigration[],
    before: null as string | null,
    expanded: false,
  });
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const visibleList = useRef(list);
  visibleList.current = list;
  const [refresh, setRefresh] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const { items, before } = list.typeId === typeId ? list : { items: [], before: null };
  const merge = (prior: EntitySchemaMigration[], incoming: EntitySchemaMigration[], prepend: boolean) => {
    const versions = new Map(prior.map((job) => [job.id, job]));
    for (const job of incoming) {
      if (!versions.has(job.id) || versions.get(job.id)!.version <= job.version) versions.set(job.id, job);
    }
    return [...new Set((prepend ? [...incoming, ...prior] : [...prior, ...incoming]).map((job) => job.id))]
      .map((id) => versions.get(id)!);
  };
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    moreRequest.current?.abort();
    moreRequest.current = null;
    setMoreBusy(false);
    setList((prior) => prior.typeId === typeId ? prior : { typeId, items: [], before: null, expanded: false });
    setError("");
    setMoreError("");
    const poll = async () => {
      try {
        const r = await api<{ items: EntitySchemaMigration[]; next_before: string | null }>(
          "GET",
          `/entity-schema-migrations?type_id=${typeId}`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const olderActive = visibleList.current.typeId === typeId
          ? visibleList.current.items.filter((job) => active(job) && !r.items.some((head) => head.id === job.id))
          : [];
        const updated = await Promise.all(olderActive.map((job) =>
          api<EntitySchemaMigration>(
            "GET",
            `/entity-schema-migrations/${job.id}`,
            undefined,
            controller.signal,
          )
        ));
        if (controller.signal.aborted) return;
        if (updated.some((job) => job.type_id !== typeId)) throw new Error("이 자료 종류의 작업이 아닙니다");
        setList((prior) => ({
          ...prior,
          items: merge(merge(prior.items, r.items, true), updated, false),
          before: prior.expanded ? prior.before : r.next_before,
        }));
        setError("");
        const displayed = merge(merge(visibleList.current.items, r.items, true), updated, false);
        if (displayed.some(active)) timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "작업 조회 실패");
          if (visibleList.current.items.some(active)) timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      clearTimeout(timer);
    };
  }, [typeId, refresh]);
  const more = async () => {
    if (!before || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMoreBusy(true);
    try {
      const r = await api<{ items: EntitySchemaMigration[]; next_before: string | null }>(
        "GET",
        `/entity-schema-migrations?type_id=${typeId}&before=${before}`,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setList((prior) => ({
        ...prior,
        items: merge(prior.items, r.items, false),
        before: r.next_before,
        expanded: true,
      }));
      setMoreError("");
      if (r.items.some(active) && !items.some(active)) setRefresh((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted) setMoreError(e instanceof Error ? e.message : "작업 조회 실패");
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (!controller.signal.aborted) setMoreBusy(false);
    }
  };
  return (
    <section aria-label="값 변환 작업">
      <h2>값 변환 작업</h2>
      {(error || moreError) && <p role="alert">{error || moreError}</p>}
      <button className="btn" onClick={() => setRefresh((n) => n + 1)}>작업 목록 다시 조회</button>
      {items.length === 0 && !error && !moreError && <p className="secondary">접수한 값 변환 작업이 없습니다.</p>}
      <ul>
        {items.map((j) => (
          <li key={j.id}>
            <Link to={materialSettingsPath(j.type_id, location.search, { job_id: j.id })}>
              <EntityTypeIcon id={j.type.icon_id} />
              {j.type.label} · {labels[j.status]} · {j.processed}/{j.total}
            </Link>
            <RecoveryAvailability job={j} />
          </li>
        ))}
      </ul>
      {before && <button className="btn" disabled={moreBusy} onClick={() => void more()}>이전 작업 더 보기</button>}
    </section>
  );
}
export function SchemaMigrationJob({ typeId: type_id, jobId: job_id, onState, onApplied, disabled = false }: {
  typeId: string;
  jobId: string;
  onState: (state: MaterialSectionState) => void;
  onApplied?: () => Promise<void>;
  disabled?: boolean;
}) {
  const location = useLocation();
  const applied = useRef(onApplied);
  applied.current = onApplied;
  const notified = useRef(new Set<string>());
  const notifying = useRef(new Set<string>());
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [job, setJob] = useState<EntitySchemaMigration>(),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const [recoveryState, setRecoveryState] = useState<MaterialSectionState>({
    dirty: false,
    busy: false,
    uncertain: false,
  });
  useLayoutEffect(() => {
    onState({
      dirty: false,
      busy: busy || recoveryState.busy,
      uncertain: uncertain || recoveryState.uncertain,
      error: !!error,
    });
  }, [busy, uncertain, error, recoveryState, onState]);
  useLayoutEffect(() => () => onState({ dirty: false, busy: false, uncertain: false }), [onState]);
  const [pendingAction, setPendingAction] = useState<"cancel" | "retry">();
  useEffect(() => {
    setJob(undefined);
    setRefreshFailed(false);
  }, [job_id, type_id]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setError("");
    const poll = async () => {
      try {
        const value = await api<EntitySchemaMigration>(
          "GET",
          `/entity-schema-migrations/${job_id}`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (value.type_id !== type_id) throw new Error("이 자료 종류의 작업이 아닙니다");
        setJob(value);
        if (
          value.status === "succeeded" && applied.current && !notified.current.has(value.id) &&
          !notifying.current.has(value.id)
        ) {
          notifying.current.add(value.id);
          try {
            await applied.current();
            if (controller.signal.aborted) return;
            notified.current.add(value.id);
            setRefreshFailed(false);
          } catch {
            if (controller.signal.aborted) return;
            setRefreshFailed(true);
            throw new Error("값 변환은 완료되었습니다. 최신 속성 조회에 실패했습니다. 상태를 다시 조회하세요.");
          } finally {
            notifying.current.delete(value.id);
          }
        }
        if (controller.signal.aborted) return;
        setError("");
        if (active(value)) timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "작업 조회 실패");
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job_id, type_id, refresh]);
  const write = async (action: "cancel" | "retry") => {
    if (!job || disabled || busy) return;
    setError("");
    setPendingAction(action);
    try {
      await attempt.run(async () => {
        await api(
          "POST",
          `/entity-schema-migrations/${job.id}/${action}`,
          { expected_job_version: job.version },
          undefined,
          attempt.requestKey(),
        );
      });
      setPendingAction(undefined);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(writeErrorMessage(e));
    }
  };
  return (
    <MaterialSettingsSection
      title="선택한 값 변환 작업"
      initialOpen
      summary={job ? `${labels[job.status]} · ${job.processed}/${job.total}` : "읽는 중…"}
      state={{
        dirty: false,
        busy: busy || recoveryState.busy,
        uncertain: uncertain || recoveryState.uncertain,
        error: !!error,
      }}
    >
      <nav aria-label="값 변환 탐색">
        <Link to={materialSettingsPath(type_id, location.search, { job_id: null })}>변경안·작업 목록</Link>{" "}
        <Link to={`/entities?entity_type_id=${type_id}`}>자료 목록</Link>
      </nav>
      <p className="secondary">
        접수한 작업은 화면을 닫거나 다른 페이지로 이동해도 계속됩니다. 다시 열면 서버의 확정 상태를 조회합니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <button className="btn" onClick={() => setRefresh((n) => n + 1)}>상태 다시 조회</button>
      {refreshFailed && <button className="btn" onClick={() => setRefresh((n) => n + 1)}>최신 속성 다시 조회</button>}
      {job && (
        <>
          <p role="status">{labels[job.status]} · {job.processed}/{job.total}개 준비</p>
          {active(job) && (
            <p>
              {job.type.label}의 수정·삭제·설정 게시와 이 종류를 포함한 연결 쓰기는 완료 또는 취소까지 차단됩니다. 현재
              자료 읽기와 다른 종류 업무는 계속할 수 있습니다.
            </p>
          )}
          {job.status === "committing" && <p>최종 적용 중입니다. 취소 대신 확정 결과를 확인하세요.</p>}
          {job.result && (
            <p>새 속성 버전 {job.result.schema_version} · {job.result.total}개 적용 · {job.result.changed}개 값 변경</p>
          )}
          {job.status !== "succeeded" && job.source_expires_at && (
            <p>원본 보존 만료: {new Date(job.source_expires_at).toLocaleString()}</p>
          )}
          {job.status === "failed" && (
            <p role="alert">
              {job.failure_reason} · 기존 자료와 속성 정의가 유지됩니다.{" "}
              {job.retryable ? "같은 작업을 재시도할 수 있습니다." : "변경안과 최신 분석을 다시 준비하세요."}
            </p>
          )}
          {job.status === "cancelled" && <p>적용 전 취소했습니다. 원본은 유지됩니다. 새 분석을 준비하여 실행하세요.</p>}
          <RecoveryChangeCreate
            key={job.id}
            job={job}
            onState={setRecoveryState}
            disabled={disabled || busy || uncertain}
          />
          <Link to={materialSettingsPath(type_id, location.search, { change_id: job.change_id, job_id: job.id })}>
            변경안 보기
          </Link>
          <div className="schema-actions">
            {["queued", "preparing", "ready_to_commit"].includes(job.status) && (
              <button
                className="btn"
                disabled={busy || uncertain || disabled}
                onClick={() => void write("cancel")}
              >
                적용 전 취소
              </button>
            )}
            {job.status === "failed" && job.retryable && (
              <button
                className="btn btn-primary"
                disabled={busy || uncertain || disabled}
                onClick={() => void write("retry")}
              >
                같은 작업 재시도
              </button>
            )}
            {uncertain && pendingAction && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void write(pendingAction)}
              >
                같은 요청 다시 확인
              </button>
            )}
          </div>
        </>
      )}
    </MaterialSettingsSection>
  );
}
