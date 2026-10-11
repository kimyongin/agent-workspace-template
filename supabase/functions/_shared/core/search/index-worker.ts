import { SEARCH_PIPELINE } from "./config.ts";

export type EmbeddingFailure = "input_limit" | "configuration" | "transient" | "invalid_response";
export class EmbeddingError extends Error {
  constructor(public readonly category: EmbeddingFailure) {
    super(category);
  }
}
export interface Embedder {
  embed(
    text: string,
    type: "passage" | "query",
    context?: { message_id: string; start: number; end: number },
  ): Promise<number[]>;
}
export class PassageEffectError extends Error {
  constructor(
    public readonly state: "busy" | "stale" | "failed" | "unknown",
    public readonly reason: string,
    public readonly attempts = 0,
  ) {
    super(reason);
  }
}
export interface IndexSource {
  body: string;
}
export interface IndexedChunk {
  /** Unicode code point offsets, end exclusive; text is transient and not stored. */
  start: number;
  end: number;
  text: string;
  vector: number[];
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
    state: "indexed" | "excluded" | "failed" | "retry" | "held",
    reason: string | null,
    chunks?: IndexedChunk[],
    delay?: number,
  ): Promise<boolean>;
}
export async function indexBatch(queue: IndexQueue, embedder: Embedder, scope: IndexScope) {
  const claims = await queue.claim(scope);
  const outcomes = await Promise.all(claims.map(async (job) => {
    const source = await queue.prepare(job.msg_id, SEARCH_PIPELINE);
    if (!source) return "stale";
    const finish = async (
      state: "indexed" | "excluded" | "failed" | "retry" | "held",
      reason: string | null,
      chunks?: IndexedChunk[],
      delay?: number,
    ) => await queue.finish(job.msg_id, SEARCH_PIPELINE, state, reason, chunks, delay) ? state : "stale";
    if (!source.body?.trim()) {
      return await finish("excluded", "invalid_input");
    }
    try {
      const points = [...source.body];
      const chunks: IndexedChunk[] = [];
      // UTF-8 bytes are a conservative upper bound for the byte-fallback model's
      // text tokens, not a token count. Leave room below the 2048-token limit.
      // Boundary preference and overlap preserve all characters, including markup.
      for (const segment of passages(points)) chunks.push(...await embedSegment(points, segment, embedder, job.msg_id));
      return await finish("indexed", null, chunks);
    } catch (error) {
      if (error instanceof PassageEffectError) {
        if (error.state === "stale") return "stale";
        if (error.state === "busy") return await finish("retry", "provider_unknown", undefined, 30);
        if (error.state === "unknown" && error.attempts >= 5) return await finish("held", "retry_exhausted");
        if (error.state === "failed" && (error.reason !== "transient" || error.attempts >= 5)) {
          return await finish("failed", error.reason);
        }
        return await finish("retry", error.reason, undefined, Math.min(900, 30 * 2 ** Math.max(0, error.attempts - 1)));
      }
      // 알 수 없는 DB/코드 오류를 공급자 장애로 분류하지 않는다. visibility timeout으로 복구한다.
      if (!(error instanceof EmbeddingError)) throw error;
      // Only a single code point can reach here: recursive splitting handles
      // ordinary input limits without excluding a long record.
      if (error.category === "input_limit") return await finish("failed", "input_limit");
      if (error.category === "configuration") return await finish("failed", "configuration");
      return await finish("retry", error.category, undefined, Math.min(900, 30 * 2 ** (job.read_ct - 1)));
    }
  }));
  return {
    claimed: claims.length,
    indexed: outcomes.filter((s) => s === "indexed").length,
    excluded: outcomes.filter((s) => s === "excluded").length,
    failed: outcomes.filter((s) => s === "failed").length,
    retry: outcomes.filter((s) => s === "retry").length,
    held: outcomes.filter((s) => s === "held").length,
    stale: outcomes.filter((s) => s === "stale").length,
  };
}

function* passages(points: string[]) {
  let start = 0;
  while (start < points.length) {
    let end = start, bytes = 0, paragraph = start, sentence = start, whitespace = start;
    while (end < points.length) {
      const size = new TextEncoder().encode(points[end]).length;
      if (bytes + size > 1800) break;
      bytes += size;
      end++;
      if (bytes >= 900) {
        if (points[end - 1] === "\n" && points[end - 2] === "\n") paragraph = end;
        if (/[.!?。！？]/u.test(points[end - 1])) sentence = end;
        if (/\s/u.test(points[end - 1])) whitespace = end;
      }
    }
    const boundary = paragraph > start ? paragraph : sentence > start ? sentence : whitespace;
    if (end < points.length && boundary > start) end = boundary;
    yield { start, end };
    if (end === points.length) return;
    // At most 180 UTF-8 bytes of overlap, always make forward progress.
    let next = end, overlap = 0;
    while (next > start + 1) {
      const size = new TextEncoder().encode(points[next - 1]).length;
      if (overlap + size > 180) break;
      overlap += size;
      next--;
    }
    start = next;
  }
}

async function embedSegment(
  points: string[],
  segment: { start: number; end: number },
  embedder: Embedder,
  messageId: string,
): Promise<IndexedChunk[]> {
  const text = points.slice(segment.start, segment.end).join("");
  try {
    return [{ ...segment, text, vector: await embedder.embed(text, "passage", { message_id: messageId, ...segment }) }];
  } catch (error) {
    if (!(error instanceof EmbeddingError) || error.category !== "input_limit" || segment.end - segment.start < 2) {
      throw error;
    }
    const middle = segment.start + Math.floor((segment.end - segment.start) / 2);
    return [
      ...await embedSegment(points, { start: segment.start, end: middle }, embedder, messageId),
      ...await embedSegment(points, { start: middle, end: segment.end }, embedder, messageId),
    ];
  }
}
