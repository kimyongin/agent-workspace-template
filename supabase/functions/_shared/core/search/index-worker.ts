import { SEARCH_PIPELINE } from "./config.ts";

export type EmbeddingFailure = "input_limit" | "configuration" | "transient" | "invalid_response";
export class EmbeddingError extends Error {
  constructor(public readonly category: EmbeddingFailure) {
    super(category);
  }
}
export interface Embedder {
  embed(text: string, type: "passage" | "query"): Promise<number[]>;
}
export interface IndexSource {
  title: string;
  summary: string | null;
}
export interface IndexClaim {
  msg_id: string;
  read_ct: number;
}
export interface IndexScope {
  limit: number;
  owner_id?: string;
  kind?: string;
  id?: string;
}
export interface IndexQueue {
  claim(scope: IndexScope): Promise<IndexClaim[]>;
  prepare(id: string, pipeline: string): Promise<IndexSource | null>;
  finish(
    id: string,
    pipeline: string,
    state: "indexed" | "excluded" | "failed" | "retry",
    reason: string | null,
    vector?: number[],
    delay?: number,
  ): Promise<boolean>;
}
export async function indexBatch(queue: IndexQueue, embedder: Embedder, scope: IndexScope) {
  const claims = await queue.claim(scope);
  const outcomes = await Promise.all(claims.map(async (job) => {
    const source = await queue.prepare(job.msg_id, SEARCH_PIPELINE);
    if (!source) return "stale";
    const finish = async (
      state: "indexed" | "excluded" | "failed" | "retry",
      reason: string | null,
      vector?: number[],
      delay?: number,
    ) => await queue.finish(job.msg_id, SEARCH_PIPELINE, state, reason, vector, delay) ? state : "stale";
    if (
      !source.title?.trim() || !source.summary?.trim() || [...source.title].length > 100 ||
      [...source.summary].length > 300
    ) {
      return await finish("excluded", "invalid_input");
    }
    if (job.read_ct > 5) return await finish("failed", "retry_exhausted");
    try {
      const vector = await embedder.embed(`${source.title}\n${source.summary}`, "passage");
      return await finish("indexed", null, vector);
    } catch (error) {
      // 알 수 없는 DB/코드 오류를 공급자 장애로 분류하지 않는다. visibility timeout으로 복구한다.
      if (!(error instanceof EmbeddingError)) throw error;
      if (error.category === "input_limit") return await finish("excluded", "input_limit");
      if (error.category === "configuration") return await finish("failed", "configuration");
      if (job.read_ct >= 5) return await finish("failed", "retry_exhausted");
      return await finish("retry", error.category, undefined, Math.min(900, 30 * 2 ** (job.read_ct - 1)));
    }
  }));
  return {
    claimed: claims.length,
    indexed: outcomes.filter((s) => s === "indexed").length,
    excluded: outcomes.filter((s) => s === "excluded").length,
    failed: outcomes.filter((s) => s === "failed").length,
    retry: outcomes.filter((s) => s === "retry").length,
    stale: outcomes.filter((s) => s === "stale").length,
  };
}
