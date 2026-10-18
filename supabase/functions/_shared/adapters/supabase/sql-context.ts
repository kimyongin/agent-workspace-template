import { runInWorkspace } from "./workspace-context.ts";
import { insertWithIdRetry } from "./data-id.ts";
import { executeSqlRequest } from "./request-ledger.ts";
import { setTagLinks } from "./tag-links.ts";
import { SqlEntityLinks } from "./entity-links.ts";
// 실제 두 도메인이 공유하는 Actor 트랜잭션·변경 메모·색인 큐 저장 배선.
import type postgres from "postgres";
import type { RequestIdentity } from "../../core/shared/request.ts";
import type { Actor } from "../../core/shared/actor.ts";
import type { IndexJob } from "../../core/shared/store.ts";
import { AppError } from "../../core/shared/errors.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
import type { ChangeInput } from "../../core/shared/changes.ts";
import { searchInputHash } from "../../core/shared/operations.ts";
import { SqlBusinessSettingsStore } from "./business-settings-store.ts";
import { effectiveRecordTemplate } from "../../contracts/record-template.ts";
import { changeDefaults } from "../../core/settings/change-defaults.ts";

export class SqlActorStore {
  protected readonly entityLinks: SqlEntityLinks;

  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {
    this.entityLinks = new SqlEntityLinks(tx);
  }
  executeRequest<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T> {
    return executeSqlRequest(this.tx, this.actor, request, execute);
  }
  async issueDataId(): Promise<string> {
    const [row] = await this.tx`select app.data_id_candidate() as id`;
    return row.id as string;
  }

  /** Explicit user commands call this once, never the internal insert itself. */
  async appendChange(input: ChangeInput) {
    const target = input.target, target_title = target.title;
    const settingsStore = new SqlBusinessSettingsStore(this.tx, this.actor);
    const settings = (await settingsStore.get()).settings;
    const ids = effectiveRecordTemplate(
      settings.record_templates,
      input.target_kind as "entity" | "task",
      input.action,
      (input.after ?? input.before)?.entity_type_id,
    ).tag_ids;
    const memo = changeDefaults(input, settings, await settingsStore.recordTags(ids));
    const body = memo.change_note;
    // New events retain facts and the final memo, not an extra full domain capture.
    // Nullable keys remain compatible with old stored snapshots and readers.
    const metadata = {
      target_kind: input.target_kind,
      target_id: target.id,
      target_title,
      action: input.action,
      source: this.actor.source ?? "http",
      before: null,
      after: null,
      path: input.action === "delete"
        ? null
        : `/${input.target_kind === "entity" ? "entities" : `${input.target_kind}s`}/${encodeURIComponent(target.id)}`,
    };
    const values = {
      owner_id: this.actor.userId,
      ...await this.entityLinks.changeSelection(input),
      body,
      record_kind: "change",
    };
    const row = await insertWithIdRetry(async () => {
      const id = await this.issueDataId();
      return await this.tx`insert into app.records ${
        this.tx({
          ...values,
          id,
          change_metadata: this.tx.json({ ...metadata, event_id: id } as never),
        })
      } on conflict (id) do nothing returning id`;
    });
    await setTagLinks(this.tx, this.actor, "record", row.id as string, memo.change_tag_ids);
    await this.enqueueIndex({
      kind: "record",
      id: row.id as string,
      input_hash: await searchInputHash(body),
    });
  }

  /** 소유자의 현재 원본 하나만 검증하는 내부 함수가 상태와 최신 큐 메시지를 같은 트랜잭션에서 교체한다. */
  async enqueueIndex(job: IndexJob) {
    await this.tx`select app.enqueue_search_index(${job.kind},${job.id},${job.input_hash},${SEARCH_PIPELINE})`;
  }
}

/** DB 오류를 업무 오류로 바꾼다. 내부 SQL·메시지는 밖으로 내보내지 않는다. */
export function translate(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string }).code ?? "";
  if (code === "42501" && (e as { message?: string }).message === "request_owner_missing") {
    return new AppError("unauthenticated", "계정을 확인할 수 없습니다");
  }
  const message = (e as { message?: string }).message;
  if (code === "P0001" && message === "workspace_lifecycle_conflict") {
    return new AppError("conflict", "공간 상태가 변경되었습니다. 최신 상태를 다시 조회하세요");
  }
  if (code === "42501" && message === "workspace_denied") {
    return new AppError("forbidden", "워크스페이스에 접근할 수 없습니다");
  }
  if (code === "P0001" && message === "workspace_version_conflict") {
    return new AppError("conflict", "참여 정보가 변경되었습니다. 다시 조회하세요");
  }
  if (code === "23514" && message === "workspace_final_admin") {
    return new AppError("conflict", "마지막 관리자는 권한을 넘기거나 공간을 삭제한 뒤 나갈 수 있습니다");
  }
  if (code === "22023" && message === "invitation_delivery_ambiguous") {
    return new AppError(
      "conflict",
      "이메일 발송 여부를 확인할 수 없어 재발송할 수 없습니다. 초대를 취소하고 새 초대를 만드세요",
    );
  }
  if (code === "40001" || code === "40P01" || code === "55P03" || code === "57014") {
    return new AppError("unavailable", "잠시 후 다시 시도하세요");
  }
  if (code === "22023" && (e as { message?: string }).message === "request_result_too_large") {
    return new AppError("invalid_input", "응답이 1 MiB 요청 보관 한도를 넘었습니다. 변경은 저장되지 않았습니다");
  }
  if (code === "23505") return new AppError("conflict", "이미 존재하는 항목입니다. 최신 데이터를 확인하세요");
  if (code === "23503") return new AppError("invalid_reference", "참조한 항목이 없거나 접근할 수 없습니다");
  if (code === "23514" || code === "22001" || code === "22P02" || code === "22023") {
    return new AppError("invalid_input", "입력 형식이 맞지 않습니다");
  }
  if (/^(08|53|57P)/.test(code) || /ECONNREFUSED|ECONNRESET|CONNECT_TIMEOUT/.test(String(code))) {
    return new AppError("unavailable", "저장소에 일시적으로 연결할 수 없습니다");
  }
  console.error("db error", code, (e as Error)?.message);
  return new AppError("internal", "서버 오류가 발생했습니다");
}

export async function runAsActor<T>(
  sql: postgres.Sql,
  actor: Actor,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  isolation?: "repeatable read" | "repeatable read read only",
): Promise<T> {
  // Integration-only seam: #513–#517 replace owner SQL and declare their concrete requirements;
  // #518 removes the unscoped branch. Explicit business transports never infer an owner workspace.
  if (actor.workspaceId) {
    return runInWorkspace(
      sql,
      { ...actor, workspaceId: actor.workspaceId },
      { mode: "business", requirements: [] },
      fn,
    );
  }
  try {
    const transaction = async (tx: postgres.TransactionSql) => {
      await tx`select set_config('request.jwt.claims', ${
        JSON.stringify({ sub: actor.userId, role: "authenticated" })
      }, true),
        set_config('lock_timeout', '5s', true), set_config('statement_timeout', '15s', true)`;
      await tx`set local role app_user`;
      return await fn(tx);
    };
    return await (isolation === "repeatable read"
      ? sql.begin("isolation level repeatable read", transaction)
      : isolation === "repeatable read read only"
      ? sql.begin("isolation level repeatable read read only", transaction)
      : sql.begin(transaction)) as T;
  } catch (e) {
    throw translate(e);
  }
}
