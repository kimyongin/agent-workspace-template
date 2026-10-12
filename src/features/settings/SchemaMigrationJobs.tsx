import { useEffect, useRef, useState } from "react";
import { RecoveryAvailability, RecoveryChangeCreate, recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { Link, useNavigate, useParams } from "react-router";
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
export function MigrationStart({ plan, disabled }: { plan: EntitySchemaChange; disabled: boolean }) {
  const navigate = useNavigate(), { attempt, busy, uncertain } = useWriteAttempt();
  const [error, setError] = useState("");
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
        navigate(`/settings/entity-types/${plan.type_id}/migrations/${acceptedRef.current.job_id}`);
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
  const [items, setItems] = useState<EntitySchemaMigration[]>([]),
    [before, setBefore] = useState<string | null>(null),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const moreRequest = useRef<AbortController | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    moreRequest.current?.abort();
    setMoreBusy(false);
    setItems([]);
    setBefore(null);
    setError("");
    const poll = async () => {
      try {
        const r = await api<{ items: EntitySchemaMigration[]; next_before: string | null }>(
          "GET",
          `/entity-schema-migrations?type_id=${typeId}`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setItems(r.items);
        setBefore(r.next_before);
        setError("");
        if (r.items.some(active)) timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "작업 조회 실패");
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
    if (moreBusy) return;
    const controller = new AbortController();
    moreRequest.current?.abort();
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
      setItems((prior) => [...prior, ...r.items]);
      setBefore(r.next_before);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "작업 조회 실패");
    } finally {
      if (!controller.signal.aborted) setMoreBusy(false);
    }
  };
  return (
    <section aria-label="값 변환 작업">
      <h2>값 변환 작업</h2>
      {error && <p role="alert">{error}</p>}
      <button className="btn" onClick={() => setRefresh((n) => n + 1)}>작업 목록 다시 조회</button>
      {items.length === 0 && !error && <p className="secondary">접수한 값 변환 작업이 없습니다.</p>}
      <ul>
        {items.map((j) => (
          <li key={j.id}>
            <Link to={`/settings/entity-types/${j.type_id}/migrations/${j.id}`}>
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
export function SchemaMigrationJob() {
  const { type_id, job_id } = useParams();
  const [job, setJob] = useState<EntitySchemaMigration>(),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const [pendingAction, setPendingAction] = useState<"cancel" | "retry">();
  useEffect(() => { setJob(undefined); }, [job_id, type_id]);
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
    if (!job) return;
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
    <section className="panel settings">
      <h1 className="page-title">
        {job && <EntityTypeIcon id={job.type.icon_id} />} {job?.type.label ?? "자료 종류"} · 값 변환 작업
      </h1>
      <nav aria-label="값 변환 탐색">
        <Link to={`/settings/entity-types/${type_id}/migrations`}>변경안·작업 목록</Link>{" "}
        <Link to={`/entities?entity_type_id=${type_id}`}>자료 목록</Link>
      </nav>
      <p className="secondary">
        접수한 작업은 화면을 닫거나 다른 페이지로 이동해도 계속됩니다. 다시 열면 서버의 확정 상태를 조회합니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <button className="btn" onClick={() => setRefresh((n) => n + 1)}>상태 다시 조회</button>
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
          {job.status !== "succeeded" && job.source_expires_at && <p>원본 보존 만료: {new Date(job.source_expires_at).toLocaleString()}</p>}
          {job.status === "failed" && (
            <p role="alert">
              {job.failure_reason} · 기존 자료와 속성 정의가 유지됩니다.{" "}
              {job.retryable ? "같은 작업을 재시도할 수 있습니다." : "변경안과 최신 분석을 다시 준비하세요."}
            </p>
          )}
          {job.status === "cancelled" && <p>적용 전 취소했습니다. 원본은 유지됩니다. 새 분석을 준비하여 실행하세요.</p>}
          <RecoveryChangeCreate key={job.id} job={job} />
          <Link to={`/settings/entity-types/${type_id}/migrations?change_id=${job.change_id}`}>변경안 보기</Link>
          <div className="schema-actions">
            {["queued", "preparing", "ready_to_commit"].includes(job.status) && (
              <button
                className="btn"
                disabled={busy || uncertain}
                onClick={() => void write("cancel")}
              >
                적용 전 취소
              </button>
            )}
            {job.status === "failed" && job.retryable && (
              <button
                className="btn btn-primary"
                disabled={busy || uncertain}
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
    </section>
  );
}
