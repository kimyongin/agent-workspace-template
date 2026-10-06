import { type Embedder, EmbeddingError } from "../../core/search/index-worker.ts";

/** 본문 구간 또는 질의 한 개만 보낸다. 공급자의 자동 절단은 금지한다. */
export class PineconeEmbedder implements Embedder {
  constructor(private readonly key: string, private readonly send: typeof fetch = fetch) {}
  async embed(text: string, type: "passage" | "query"): Promise<number[]> {
    let response: Response;
    try {
      response = await this.send("https://api.pinecone.io/embed", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "Api-Key": this.key, "X-Pinecone-Api-Version": "2026-07", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-text-embed-v2",
          inputs: [{ text }],
          parameters: { input_type: type, dimension: 1024, truncate: "NONE" },
        }),
      });
    } catch {
      throw new EmbeddingError("transient");
    }
    // 응답 크기를 제한한다. 외부 오류 원문·입력·키를 로그나 공개 오류에 넣지 않는다.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (!reader) throw new Error();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128_000) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(value);
      }
    } catch {
      throw new EmbeddingError("invalid_response");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      if (response.ok) throw new EmbeddingError("invalid_response");
    }
    if (!response.ok) {
      const message = data?.error?.message ?? data?.message ?? "";
      if (
        response.status === 400 &&
        /exceed|too.*long|token.*limit|maximum.*(sequence|token)|tokens were truncated|max length per sequence/i.test(
          message,
        )
      ) {
        throw new EmbeddingError("input_limit");
      }
      throw new EmbeddingError(response.status === 429 || response.status >= 500 ? "transient" : "configuration");
    }
    const vector: unknown = data?.data?.[0]?.values;
    if (
      data?.model !== "llama-text-embed-v2" || data?.vector_type !== "dense" || data?.data?.length !== 1 ||
      data.data[0].vector_type !== "dense" || !Array.isArray(vector) || vector.length !== 1024 ||
      !vector.every((v) => typeof v === "number" && Number.isFinite(v)) || vector.every((v) => v === 0)
    ) {
      throw new EmbeddingError("invalid_response");
    }
    return vector;
  }
}
