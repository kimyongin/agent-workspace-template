import { dataId } from "../_shared/contracts/data-id.ts";
import { SqlExternalEffectLedger } from "../_shared/adapters/supabase/external-effect.ts";
import { DurablePassageEmbedder, hashPassage } from "../_shared/core/search/passage-embedder.ts";
import postgres from "postgres";
import { z } from "zod";
import { SqlIndexQueue } from "../_shared/adapters/supabase/index-queue.ts";
import { PineconeEmbedder } from "../_shared/adapters/pinecone/embedder.ts";
import { indexBatch } from "../_shared/core/search/index-worker.ts";
import { invalidWorkerSettings } from "../_shared/adapters/worker-configuration.ts";

const input = z.strictObject({
  limit: z.number().int().min(1).max(5).default(5),
  owner_id: dataId.optional(),
  kind: z.enum(["task", "record", "principle"]).optional(),
  id: dataId.optional(),
});
let sql: postgres.Sql | undefined;
Deno.serve(async (request) => {
  const token = Deno.env.get("INDEX_WORKER_TOKEN");
  // 인증 전에 DB 연결·큐 claim·외부 호출을 하지 않는다. 사용자 HTTP/MCP 토큰은 받지 않는다.
  if (!token || token.length < 43) {
    console.error(JSON.stringify({ event: "worker_not_configured", invalid_settings: ["INDEX_WORKER_TOKEN"] }));
    return Response.json({ error: "worker_not_configured" }, { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (Number(request.headers.get("Content-Length")) > 2048) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  let scope;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    scope = input.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const key = Deno.env.get("PINECONE_API_KEY"), url = Deno.env.get("WORKER_DB_URL");
  const accountScope = Deno.env.get("PINECONE_ACCOUNT_SCOPE");
  const invalidSettings = invalidWorkerSettings({
    INDEX_WORKER_TOKEN: token,
    PINECONE_API_KEY: key,
    WORKER_DB_URL: url,
    PINECONE_ACCOUNT_SCOPE: accountScope,
  });
  if (!key || !url || !accountScope || invalidSettings.length) {
    console.error(JSON.stringify({ event: "worker_not_configured", invalid_settings: invalidSettings }));
    return Response.json({ error: "worker_not_configured" }, { status: 503 });
  }
  try {
    sql ??= postgres(url, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connection: { statement_timeout: 15_000, lock_timeout: 5_000 },
      onnotice: () => {},
    });
    return Response.json(
      await indexBatch(
        new SqlIndexQueue(sql),
        new DurablePassageEmbedder(
          new SqlExternalEffectLedger(sql),
          new PineconeEmbedder(key),
          await hashPassage(accountScope),
        ),
        scope,
      ),
    );
  } catch {
    // 상세 원문·DB 오류·비밀을 공개하지 않는다. claim된 작업은 visibility timeout 이후 다시 읽힌다.
    return Response.json({ error: "worker_failed" }, { status: 503 });
  }
});
