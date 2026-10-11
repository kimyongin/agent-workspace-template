import { SEARCH_PIPELINE } from "./config.ts";
import { executePassageEffect, type PassageEffectLedger, type PassageProvider } from "./external-effect.ts";
import { type Embedder, EmbeddingError, PassageEffectError } from "./index-worker.ts";

export async function hashPassage(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Passage-only orchestration; query calls retain their single-call budget policy. */
export class DurablePassageEmbedder implements Embedder {
  constructor(
    private readonly ledger: PassageEffectLedger,
    private readonly provider: PassageProvider,
    private readonly scope: string,
  ) {}
  async embed(
    text: string,
    type: "passage" | "query",
    context?: { message_id: string; start: number; end: number },
  ): Promise<number[]> {
    if (type !== "passage" || !context) throw new Error("passage_context_required");
    const result = await executePassageEffect(
      this.ledger,
      this.provider,
      {
        ...context,
        pipeline: SEARCH_PIPELINE,
        provider_scope: this.scope,
        model: "llama-text-embed-v2",
        dimensions: 1024,
        input_hash: await hashPassage(text),
      },
      text,
    );
    if (result.state === "succeeded") return result.vector;
    if (result.state === "failed" && result.reason === "input_limit") throw new EmbeddingError("input_limit");
    throw new PassageEffectError(
      result.state,
      "reason" in result ? result.reason : "provider_unknown",
      "attempts" in result ? result.attempts : 0,
    );
  }
}
