import { captureEntities } from "./entity-links.ts";
// 실제 두 도메인이 공유하는 Actor 트랜잭션·요청 결과·색인 큐 저장 배선.
import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type { IndexJob } from "../../core/shared/store.ts";
import { AppError } from "../../core/shared/errors.ts";
import { SEARCH_PIPELINE } from "../../core/search/config.ts";
import type { ChangeInput } from "../../core/shared/changes.ts";
import { searchInputHash } from "../../core/shared/operations.ts";
import { basicChangeMemo } from "../../core/shared/change-memo.ts";

const REQUEST_RETENTION = "7 days";
export class SqlActorStore {
  constructor(protected readonly tx: postgres.TransactionSql, protected readonly actor: Actor) {}

  async lockRequest(operation: string, requestId: string) {
    await this
      .tx`select pg_advisory_xact_lock(hashtextextended(${`${this.actor.userId}:${operation}:${requestId}`}, 0))`;
  }

  /** Explicit user commands call this once, never the internal insert itself. */
  async appendChange(input: ChangeInput) {
    const target = input.target, target_title = target.title;
    const { title, summary, body } = input.change_memo ?? basicChangeMemo({ ...input, target_title });
    // New events retain facts and the final memo, not an extra full domain capture.
    // Nullable keys remain compatible with old stored snapshots and readers.
    const metadata = {
      event_id: crypto.randomUUID(),
      target_kind: input.target_kind,
      target_id: target.id,
      target_title,
      action: input.action,
      source: this.actor.source ?? "http",
      before: null,
      after: null,
      path: input.action === "delete"
        ? null
        : `/${input.target_kind === "entity" ? "entities" : `${input.target_kind}s`}/${target.id}`,
    };
    const ids = target.entity_ids;
    const context = input.target_kind === "entity" && input.action === "delete"
      ? [{
        id: target.id,
        title: target_title,
        captured_at: new Date().toISOString(),
        source: "selection" as const,
      }]
      : await captureEntities(this.tx, ids, target.entity_context);
    const [row] = await this
      .tx`insert into app.records(owner_id,entity_ids,entity_context,title,summary,body,record_kind,change_note,change_metadata)
      values(${this.actor.userId},${this.tx.array(ids, 2950)},${
      this.tx.json(context)
    },${title},${summary},${body}, 'change',${input.change_note ?? null},${
      this.tx.json(metadata as never)
    }) returning id`;
    await this.enqueueIndex({
      kind: "record",
      id: row.id as string,
      input_hash: await searchInputHash({ title, summary }),
    });
  }

  async findRequest(operation: string, requestId: string) {
    // 보관 기간이 지난 결과는 지우고 새 요청으로 처리한다.
    await this.tx`
      delete from app.request_results
      where operation = ${operation} and request_id = ${requestId}
        and created_at <= now() - ${REQUEST_RETENTION}::interval`;
    const [row] = await this.tx<{ request_hash: string; response: unknown }[]>`
      select request_hash, response from app.request_results
      where operation = ${operation} and request_id = ${requestId}`;
    return row ?? null;
  }

  async saveRequest(operation: string, requestId: string, requestHash: string, response: unknown) {
    await this.tx`
      insert into app.request_results (owner_id, operation, request_id, request_hash, response)
      values (${this.actor.userId}, ${operation}, ${requestId}, ${requestHash}, ${this.tx.json(response as never)})`;
  }

  /** 소유자의 현재 원본 하나만 검증하는 내부 함수가 상태와 최신 큐 메시지를 같은 트랜잭션에서 교체한다. */
  async enqueueIndex(job: IndexJob) {
    await this.tx`select app.enqueue_search_index(${job.kind},${job.id},${job.input_hash},${SEARCH_PIPELINE})`;
  }
}

/** DB 오류를 업무 오류로 바꾼다. 내부 SQL·메시지는 밖으로 내보내지 않는다. */
function translate(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string }).code ?? "";
  if (code === "40001" || code === "40P01" || code === "55P03" || code === "57014") {
    return new AppError("unavailable", "잠시 후 다시 시도하세요");
  }
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
): Promise<T> {
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${
        JSON.stringify({ sub: actor.userId, role: "authenticated" })
      }, true),
        set_config('lock_timeout', '5s', true), set_config('statement_timeout', '15s', true)`;
      await tx`set local role app_user`;
      return await fn(tx);
    }) as T;
  } catch (e) {
    throw translate(e);
  }
}
