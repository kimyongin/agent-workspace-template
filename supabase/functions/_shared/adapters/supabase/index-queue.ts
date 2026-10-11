import type postgres from "postgres";
import type { IndexClaim, IndexedChunk, IndexQueue, IndexScope, IndexSource } from "../../core/search/index-worker.ts";

export class SqlIndexQueue implements IndexQueue {
  constructor(private readonly sql: postgres.Sql) {}
  async claim(scope: IndexScope): Promise<IndexClaim[]> {
    const rows = await this.sql`select * from app.claim_search_index(${scope.limit},${scope.owner_id ?? null}::uuid,
      ${scope.kind ?? null},${scope.id ?? null}::text)`;
    return rows.map((r) => ({ msg_id: String(r.msg_id), read_ct: r.read_ct as number }));
  }
  async prepare(id: string, pipeline: string): Promise<IndexSource | null> {
    const [r] = await this.sql`select app.prepare_search_index(${id}::bigint,${pipeline}) as source`;
    return r.source as IndexSource | null;
  }
  async finish(
    id: string,
    pipeline: string,
    state: "indexed" | "excluded" | "failed" | "retry" | "held",
    reason: string | null,
    chunks?: IndexedChunk[],
    delay = 0,
  ): Promise<boolean> {
    const [r] = await this.sql`select app.finish_search_index(${id}::bigint,${pipeline},${state},${reason},
      ${
      chunks ? this.sql.json(chunks.map(({ start, end, vector }) => ({ start, end, vector }))) : null
    }::jsonb,${delay}) as applied`;
    return r.applied as boolean;
  }
}
