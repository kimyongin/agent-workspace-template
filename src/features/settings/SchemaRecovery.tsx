import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { api } from "../../lib/api.ts";
import { ApiError } from "../../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";

const recoveryLabels = {
  available: "복구안 생성 가능",
  expired: "원본 보존 기간 만료",
  unavailable: "복구 원본 없음",
  conflict: "이후 변경 확인 필요",
};
export function RecoveryAvailability({ job }: { job: EntitySchemaMigration }) {
  if (job.status !== "succeeded") return null;
  return (
    <p className="secondary">
      {job.recovery ? recoveryLabels[job.recovery.status] : "복구 가능 여부 확인 필요"}
      {job.recovery?.reason && <> · {job.recovery.reason}</>}
      {job.source_expires_at && <> · 원본 보존 만료: <time dateTime={job.source_expires_at}>{new Date(job.source_expires_at).toLocaleString()}</time></>}
    </p>
  );
}
export function recoveryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "migration_source_expired") return "원본 보존 기간이 만료되어 복구를 진행할 수 없습니다. 현재 자료를 확인하고 새 변경안을 준비하세요. 입력한 내용은 유지됩니다.";
    if (error.code === "conflict" || error.code === "schema_plan_stale") return `${error.message} 이후 수정된 자료·속성·연결을 확인하세요. 입력은 유지됩니다. 현재 자료를 직접 보완하거나 새 변경안을 분석한 뒤 복구 가능 여부를 다시 확인하세요.`;
  }
  return writeErrorMessage(error);
}
export function submitRecoveryChange(job: EntitySchemaMigration, requestKey: string, client = api) {
  if (!job.recovery) throw new Error("복구 가능 여부를 다시 조회하세요.");
  return client<EntitySchemaChange>(
    "POST",
    `/entity-schema-migrations/${job.id}/recovery-changes`,
    {
      expected_job_version: job.version,
      expected_type_version: job.recovery.current_type_version,
      expected_schema_version: job.recovery.current_schema_version,
    },
    undefined,
    requestKey,
  );
}
export function RecoveryChangeCreate({ job }: { job: EntitySchemaMigration }) {
  const navigate = useNavigate();
  const { attempt, busy, uncertain } = useWriteAttempt();
  const [error, setError] = useState("");
  const created = useRef<EntitySchemaChange | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const create = async () => {
    setError("");
    try {
      await attempt.run(async () => {
        created.current = await submitRecoveryChange(job, attempt.requestKey());
      });
      if (mounted.current && created.current) navigate(`/settings/entity-types/${job.type_id}/migrations?change_id=${created.current.id}`);
    } catch (e) {
      if (mounted.current) setError(recoveryErrorMessage(e));
    }
  };
  if (job.status !== "succeeded") return null;
  return (
    <section className="schema-summary" aria-label="원본 복구">
      <h2>원본 복구</h2>
      <RecoveryAvailability job={job} />
      <p>보존된 원본으로 새 변경안을 만듭니다. 생성 후 영향 분석과 자료별 변경 전후 값을 검토하고 직접 실행하세요.</p>
      <p className="secondary">현재 이름·아이콘과 과거 기록은 유지합니다. 이후 자료 수정·생성·삭제·속성·연결 변경이 있으면 확인과 보완이 필요합니다.</p>
      {job.recovery?.status === "conflict" && <p>현재 자료·속성·연결을 확인하고 직접 보완하거나 새 변경안을 분석하세요. 이후 변경을 자동으로 덮어쓰지 않습니다.</p>}
      {job.recovery?.status === "unavailable" && <p>이 작업의 원본을 사용할 수 없습니다. 현재 자료에서 새 변경안을 준비하세요.</p>}
      {job.recovery?.status === "expired" && <p>보존 기한이 지난 원본으로는 복구할 수 없습니다. 현재 자료에서 새 변경안을 준비하세요.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="schema-actions">
        <button className="btn btn-primary" disabled={busy || (!uncertain && job.recovery?.status !== "available")} onClick={() => void create()}>
          {busy ? "복구안 생성 중…" : uncertain ? "같은 복구안 요청 다시 확인" : "원본 복구안 만들기"}
        </button>
        <Link to={`/settings/entity-types/${job.type_id}/migrations`}>변경안·분석 확인</Link>
      </div>
    </section>
  );
}
