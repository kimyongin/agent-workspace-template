import { DataFields } from "@/components/DataFields";
import { useSettingsAccess } from "./workspace-settings-access.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { Button } from "../../components/ui/button.tsx";
import { materialSettingsPath } from "./material-settings-path.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "../../lib/workspace-router.tsx";
import type { EntitySchemaMigration } from "@contracts/entity-schema-migration.ts";
import { entityPath, entityReferenceId } from "@contracts/entity-identity.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import type { ApiRequest } from "../../lib/api.ts";
import { ApiError } from "../../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { schemaEntityLabel } from "./schema-labels.ts";

const recoveryLabels = {
  available: "복구안 생성 가능",
  expired: "원본 보존 기간 만료",
  unavailable: "복구 원본 없음",
  conflict: "이후 변경 확인 필요",
};
export function RecoveryAvailability({ job }: { job: EntitySchemaMigration }) {
  if (job.status !== "succeeded") return null;
  return (
    <DataFields>
      <div>
        <dt>복구 상태</dt>
        <dd>{job.recovery ? recoveryLabels[job.recovery.status] : "복구 가능 여부 확인 필요"}</dd>
      </div>
      {job.recovery?.reason && (
        <div className="col-span-full">
          <dt>사유</dt>
          <dd>{job.recovery.reason}</dd>
        </div>
      )}
      {job.source_expires_at && (
        <div>
          <dt>원본 보존 만료</dt>
          <dd>
            <time dateTime={job.source_expires_at}>{new Date(job.source_expires_at).toLocaleString()}</time>
          </dd>
        </div>
      )}
    </DataFields>
  );
}
type RecoveryConflict = { path: string; message: string };
function conflictTarget(path: string) {
  const id = path.startsWith("entities.") ? path.slice("entities.".length) : null;
  return id && entityReferenceId.safeParse(id).success ? id : null;
}
function conflictLabel(path: string) {
  const id = conflictTarget(path);
  return id
    ? schemaEntityLabel(id)
    : path === "references"
    ? "연결·선택"
    : path === "entities.removed"
    ? "자료 구성"
    : path;
}
export function RecoveryConflictList({ conflicts }: { conflicts?: RecoveryConflict[] }) {
  if (!conflicts?.length) return null;
  return (
    <section aria-label="복구 충돌 대상">
      <h3 className="text-base font-semibold">확인이 필요한 변경</h3>
<BusinessTable label="복구 충돌 대상 목록" columns={["대상", "사유"]} disclosureColumn={false}>
        {conflicts.slice(0, 21).map((conflict, index) => {
          const id = conflictTarget(conflict.path);
          return (
            <BusinessRow key={`${conflict.path}-${index}`}>
              <BusinessCell index={0}>
                {id ? <Link to={entityPath(id)}>{schemaEntityLabel(id)}</Link> : conflictLabel(conflict.path)}
              </BusinessCell>
              <BusinessCell index={1}>{conflict.message}</BusinessCell>
            </BusinessRow>
          );
        })}
      </BusinessTable>
      <p className="text-sm text-muted-foreground">
        한 번에 최대 21개 사유를 표시합니다. 현재 자료와 연결을 확인한 뒤 보완하거나 새 변경안을 분석하세요.
      </p>
    </section>
  );
}
export function recoveryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.fields.slice(0, 21).map((field) => `${conflictLabel(field.path)}: ${field.message}`).join(
      " · ",
    );
    const detail = fields ? ` ${fields}` : "";
    if (error.code === "migration_source_expired") {
      return `원본 보존 기간이 만료되어 복구를 진행할 수 없습니다. 현재 자료를 확인하고 새 변경안을 준비하세요. 입력한 내용은 유지됩니다.${detail}`;
    }
    if (error.code === "entity_type_archived") {
      return `${error.message} 입력은 유지됩니다. 자료 종류를 먼저 복원한 뒤 현재 자료·입력 항목·연결과 복구 가능 여부를 확인하세요.${detail}`;
    }
    if (error.code === "conflict" || error.code === "schema_plan_stale" || error.code === "schema_changed") {
      return `${error.message} 이후 수정된 자료·입력 항목·연결을 확인하세요. 입력은 유지됩니다. 현재 자료를 직접 보완하거나 새 변경안을 분석한 뒤 복구 가능 여부를 다시 확인하세요.${detail}`;
    }
    return `${writeErrorMessage(error)}${detail}`;
  }
  return writeErrorMessage(error);
}
export function submitRecoveryChange(job: EntitySchemaMigration, requestKey: string, client: ApiRequest) {
  if (!job.recovery) throw new Error("복구 가능 여부를 다시 조회하세요.");
  return client<EntitySchemaChange>(
    "POST",
    `/entity-schema-migrations/${job.id}/recovery-changes`,
    {
      expected_job_version: job.version,
      expected_schema_version: job.recovery.current_schema_version,
    },
    undefined,
    requestKey,
  );
}
export function RecoveryChangeCreate({ job, onState, disabled = false }: {
  job: EntitySchemaMigration;
  onState?: (state: MaterialSectionState) => void;
  disabled?: boolean;
}) {
  const { canWrite } = useSettingsAccess();
  const api = useApi();
  const navigate = useNavigate(), location = useLocation();
  const { attempt, busy, uncertain } = useWriteAttempt();
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    onState?.({ dirty: false, busy, uncertain, error: !!error });
  }, [busy, uncertain, error, onState]);
  useLayoutEffect(() => () => onState?.({ dirty: false, busy: false, uncertain: false }), [onState]);
  const created = useRef<EntitySchemaChange | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const create = async () => {
    if (!canWrite || disabled || busy) return;
    setError("");
    try {
      await attempt.run(async () => {
        created.current = await submitRecoveryChange(job, attempt.requestKey(), api);
      });
      if (mounted.current && created.current) {
        const params = new URLSearchParams(location.search);
        params.set("change_id", created.current.id);
        params.set("job_id", job.id);
        // Let the confirmed write's state reach the shared workspace guard before this outcome navigation.
        requestAnimationFrame(() => {
          if (mounted.current) navigate(`/settings/entity-types/${job.type_id}?${params}`);
        });
      }
    } catch (e) {
      if (mounted.current) setError(recoveryErrorMessage(e));
    }
  };
  if (job.status !== "succeeded") return null;
  return (
    <section className="min-w-0" aria-label="원본 복구">
      <h2 className="text-base font-semibold">원본 복구</h2>
      <RecoveryAvailability job={job} />
      <p>보존된 원본으로 새 변경안을 만듭니다. 생성 후 영향 분석과 자료별 변경 전후 값을 검토하고 직접 실행하세요.</p>
      <p className="text-sm text-muted-foreground">
        현재 이름·아이콘과 과거 기록은 유지합니다. 이후 자료 수정·생성·삭제·입력 항목·연결 변경이 있으면 확인과 보완이
        필요합니다.
      </p>
      {job.recovery?.status === "conflict" && (
        <p>
          현재 자료·입력 항목·연결을 확인하고 직접 보완하거나 새 변경안을 분석하세요. 이후 변경을 자동으로 덮어쓰지
          않습니다.
        </p>
      )}
      <RecoveryConflictList conflicts={job.recovery?.conflicts} />
      {job.recovery?.status === "unavailable" && (
        <p>이 작업의 원본을 사용할 수 없습니다. 현재 자료에서 새 변경안을 준비하세요.</p>
      )}
      {job.recovery?.status === "expired" && (
        <p>보존 기한이 지난 원본으로는 복구할 수 없습니다. 현재 자료에서 새 변경안을 준비하세요.</p>
      )}
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="default"

          disabled={!canWrite || busy || disabled || (!uncertain && job.recovery?.status !== "available")}
          onClick={() => void create()}
        >
          {busy ? "복구안 생성 중…" : uncertain ? "같은 복구안 요청 다시 확인" : "원본 복구안 만들기"}
        </Button>
        <Link to={materialSettingsPath(job.type_id, location.search)}>변경안·분석 확인</Link>
      </div>
    </section>
  );
}
