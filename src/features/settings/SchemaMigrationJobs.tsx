import { DataFields } from "@/components/DataFields";
import { useSettingsAccess } from "./workspace-settings-access.tsx";
import { useApi } from "../../lib/api-context.tsx";
import { RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

import { Button } from "../../components/ui/button.tsx";

import { materialSettingsPath } from "./material-settings-path.ts";
import { type MaterialSectionState } from "./MaterialSettingsSection.tsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RecoveryChangeCreate, recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { useLocation, useNavigate } from "../../lib/workspace-router.tsx";
import type { EntitySchemaMigration, SchemaMigrationAccepted } from "@contracts/entity-schema-migration.ts";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";

import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { migrationLabels, migrationActive } from "./schema-migration-status.ts";
export { migrationLabels } from "./schema-migration-status.ts";
export { migrationActive } from "./schema-migration-status.ts";
export function useMigrationHistory(typeId: string, selectedJob?: string) {
  const api = useApi();
  const [list, setList] = useState({
    typeId,
    items: [] as EntitySchemaMigration[],
    before: null as string | null,
    expanded: false,
  });
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [selectedError, setSelectedError] = useState("");
  const [selectedChange, setSelectedChange] = useState<EntitySchemaChange>();
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
    setSelectedError("");
    setSelectedChange(undefined);
    if (selectedJob) {
      void api<EntitySchemaMigration>("GET", `/entity-schema-migrations/${selectedJob}`, undefined, controller.signal)
        .then(async (job) => {
          if (controller.signal.aborted) {
            return;
          }
          if (job.type_id !== typeId) {
            throw new Error("이 자료 종류의 작업이 아닙니다");
          }
          setList((prior) => ({
            ...prior,
            typeId,
            items: merge(prior.typeId === typeId ? prior.items : [], [job], false),
          }));
          const change = await api<EntitySchemaChange>(
            "GET",
            `/entity-types/${typeId}/schema-changes/${job.change_id}`,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (change.type_id !== typeId || change.id !== job.change_id) throw new Error("이 작업의 변경안이 아닙니다");
          setSelectedChange(change);
        }).catch((error) => {
          if (!controller.signal.aborted) setSelectedError(error instanceof Error ? error.message : "작업 조회 실패");
        });
    }
    return () => controller.abort();
  }, [typeId, selectedJob, refresh]);
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
        if (r.items.some((job) => job.type_id !== typeId)) throw new Error("이 자료 종류의 작업이 아닙니다");
        const olderActive = visibleList.current.typeId === typeId
          ? visibleList.current.items.filter((job) =>
            migrationActive(job) && !r.items.some((head) => head.id === job.id)
          )
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
        if (displayed.some(migrationActive)) timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "작업 조회 실패");
          if (visibleList.current.items.some(migrationActive)) timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      clearTimeout(timer);
    };
  }, [typeId, refresh, selectedJob]);
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
      if (r.items.some(migrationActive) && !items.some(migrationActive)) setRefresh((n) => n + 1);
    } catch (e) {
      if (!controller.signal.aborted) setMoreError(e instanceof Error ? e.message : "작업 조회 실패");
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
      if (!controller.signal.aborted) setMoreBusy(false);
    }
  };
  const accept = useCallback((job: EntitySchemaMigration) => {
    if (job.type_id !== typeId) return;
    setList((prior) => prior.typeId === typeId ? { ...prior, items: merge(prior.items, [job], false) } : prior);
  }, [typeId]);
  return {
    items,
    before,
    selectedChange,
    error: error || moreError || selectedError,
    moreBusy,
    more,
    refresh: () => setRefresh((n) => n + 1),
    accept,
  };
}

export function SchemaMigrationJob(
  { typeId: type_id, jobId: job_id, onState, onApplied, onJobChange, publicationError = "", disabled = false }: {
    typeId: string;
    jobId: string;
    onState: (state: MaterialSectionState) => void;
    onApplied?: (job: EntitySchemaMigration) => Promise<string>;
    onJobChange?: (job: EntitySchemaMigration) => void;
    publicationError?: string;
    disabled?: boolean;
  },
) {
  const { canWrite } = useSettingsAccess();
  const api = useApi();
  const applied = useRef(onApplied);
  applied.current = onApplied;
  const changed = useRef(onJobChange);
  changed.current = onJobChange;
  const [job, setJob] = useState<EntitySchemaMigration>(),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const navigate = useNavigate(), location = useLocation();
  const [accepted, setAccepted] = useState<SchemaMigrationAccepted | null>(null);
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
      error: !!error || !!publicationError,
    });
  }, [busy, uncertain, error, publicationError, recoveryState, onState]);
  useLayoutEffect(() => () => onState({ dirty: false, busy: false, uncertain: false }), [onState]);
  const [pendingAction, setPendingAction] = useState<"cancel" | "retry">();
  useEffect(() => {
    if (!accepted || busy || uncertain) return;
    // onState propagates busy through ancestor state; its guards commit after this effect flush.
    const frame = requestAnimationFrame(() => {
      setAccepted(null);
      void navigate(materialSettingsPath(type_id, location.search, {
        job_id: accepted.job_id,
        change_id: accepted.change_id,
      }));
    });
    return () => cancelAnimationFrame(frame);
  }, [accepted, busy, uncertain, navigate, type_id, location.search]);
  useEffect(() => {
    setJob(undefined);
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
        changed.current?.(value);
        setJob((current) => current?.id === value.id && current.version > value.version ? current : value);
        if (value.status === "succeeded" && applied.current) {
          const failure = await applied.current(value);
          if (controller.signal.aborted) return;
          if (failure) {
            setError("");
            timer = setTimeout(() => void poll(), 3000);
            return;
          }
        }
        if (controller.signal.aborted) return;
        setError("");
        if (migrationActive(value)) timer = setTimeout(() => void poll(), 1200);
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
    if (!canWrite || !job || disabled || busy) return;
    setError("");
    setPendingAction(action);
    try {
      await attempt.run(async () => {
        const confirmed = await api<EntitySchemaMigration | SchemaMigrationAccepted>(
          "POST",
          `/entity-schema-migrations/${job.id}/${action}`,
          { expected_job_version: job.version },
          undefined,
          attempt.requestKey(),
        );
        // Cancel returns the full job; retry seals a new execution while preserving the failed job.
        if ("id" in confirmed) {
          changed.current?.(confirmed);
          setJob((current) =>
            current?.id === confirmed.id && current.version > confirmed.version ? current : confirmed
          );
        } else {
          if (confirmed.type_id !== type_id || confirmed.change_id !== job.change_id) {
            throw new Error("이 자료 종류의 변경안 재시도 접수가 아닙니다");
          }
          setAccepted(confirmed);
        }
      });
      setPendingAction(undefined);
      if (action === "cancel") setRefresh((n) => n + 1);
    } catch (e) {
      setError(writeErrorMessage(e));
    }
  };
  return (
    <section aria-label="값 변환 상세" className="flex min-w-0 flex-col gap-4">
      <h3 className="text-base font-semibold">값 변환</h3>
      <p className="text-sm text-muted-foreground">
        접수한 작업은 화면을 닫거나 다른 페이지로 이동해도 계속됩니다. 다시 열면 서버의 확정 상태를 조회합니다.
      </p>
      {(error || publicationError) && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error || publicationError}</AlertDescription></Alert>}
      <Button variant="ghost" type="button"  onClick={() => setRefresh((n) => n + 1)}><RotateCcwIcon data-icon="inline-start" />상태 다시 조회</Button>
      {publicationError && (
        <Button variant="ghost" type="button"  onClick={() => setRefresh((n) => n + 1)}><RotateCcwIcon data-icon="inline-start" />
          최신 입력 항목 다시 조회
        </Button>
      )}
      {job && (
        <>
          <DataFields role="status">
            <div>
              <dt>상태</dt>
              <dd>{migrationLabels[job.status]}</dd>
            </div>
            <div>
              <dt>준비한 자료</dt>
              <dd>{job.processed}/{job.total}개 준비</dd>
            </div>
          </DataFields>
          {migrationActive(job) && (
            <Progress aria-label="값 변환 진행률" value={job.processed / Math.max(job.total, 1) * 100} aria-valuetext={`${job.processed}/${job.total}개`} />
          )}
          {migrationActive(job) && (
            <p>
              {job.type.label}의 수정·삭제·설정 적용와 이 종류를 포함한 연결 쓰기는 완료 또는 취소까지 차단됩니다. 현재
              자료 읽기와 다른 종류 업무는 계속할 수 있습니다.
            </p>
          )}
          {job.status === "committing" && <p>최종 적용 중입니다. 취소 대신 확정 결과를 확인하세요.</p>}
          {job.result && (
            <DataFields>
              <div>
                <dt>새 입력 항목 버전</dt>
                <dd>{job.result.schema_version}</dd>
              </div>
              <div>
                <dt>적용</dt>
                <dd>{job.result.total}개 적용</dd>
              </div>
              <div>
                <dt>값 변경</dt>
                <dd>{job.result.changed}개 값 변경</dd>
              </div>
            </DataFields>
          )}
          {job.status !== "succeeded" && job.source_expires_at && (
            <DataFields>
              <div>
                <dt>원본 보존 만료</dt>
                <dd>
                  <time dateTime={job.source_expires_at}>{new Date(job.source_expires_at).toLocaleString()}</time>
                </dd>
              </div>
            </DataFields>
          )}
          {job.status === "failed" && (
            <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>
              {job.failure_reason} · 기존 자료와 입력 항목 정의가 유지됩니다.{" "}
              {job.retryable ? "같은 작업을 재시도할 수 있습니다." : "변경안과 최신 분석을 다시 준비하세요."}
            </AlertDescription></Alert>
          )}
          {job.status === "cancelled" && (
            <p>값 변환을 취소했습니다. 원본은 유지됩니다. 새 분석을 준비하여 실행하세요.</p>
          )}
          <RecoveryChangeCreate
            key={job.id}
            job={job}
            onState={setRecoveryState}
            disabled={!canWrite || disabled || busy || uncertain}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {["queued", "preparing", "ready_to_commit"].includes(job.status) && (
              <Button variant="outline"

                disabled={!canWrite || busy || uncertain || disabled}
                onClick={() => void write("cancel")}
              >
                변환 취소
              </Button>
            )}
            {job.status === "failed" && job.retryable && (
              <Button variant="default"

                disabled={!canWrite || busy || uncertain || disabled}
                onClick={() => void write("retry")}
              >
                같은 작업 재시도
              </Button>
            )}
            {uncertain && pendingAction && (
              <Button variant="outline"

                disabled={!canWrite || busy}
                onClick={() => void write(pendingAction)}
              >
                같은 요청 다시 확인
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
