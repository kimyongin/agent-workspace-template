import postgres from "postgres";
import { z } from "zod";
import { compileMigration } from "../../core/entity-types/conversions.ts";
const input = z.strictObject({ limit: z.literal(1).default(1), check_configuration: z.literal(true).optional() });
export function entitySchemaWorker(readEnv: (name: string) => string | undefined) {
  let sql: postgres.Sql | undefined;
  return async (request: Request): Promise<Response> => {
    const token = readEnv("ENTITY_SCHEMA_WORKER_TOKEN");
    if (!token || token.length < 43) return Response.json({ error: "worker_not_configured" }, { status: 503 });
    if (request.headers.get("Authorization") !== `Bearer ${token}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    let scope;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      let text = "", bytes = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2048) {
          await reader.cancel();
          throw new Error();
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      scope = input.parse(JSON.parse(text));
    } catch {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }
    const url = readEnv("WORKER_DB_URL");
    if (!url) return Response.json({ error: "worker_not_configured" }, { status: 503 });
    if (scope.check_configuration) return Response.json({ configuration_checked: true });
    try {
      sql ??= postgres(url, {
        prepare: false,
        max: 1,
        idle_timeout: 20,
        connection: { statement_timeout: 15000, lock_timeout: 5000 },
        onnotice: () => {},
      });
      const [claimed] = await sql`select app.claim_entity_schema_analysis() as batch`;
      const batch = claimed.batch;
      if (!batch) return Response.json({ processed: 0 });
      let results;
      try {
        const convert = compileMigration(batch.target, batch.migration);
        results = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
          convert(row.entity_id, row.properties)
        );
      } catch {
        await sql`select app.fail_entity_schema_analysis(${batch.id},${batch.fence})`;
        return Response.json({ processed: 0, analysis_failed: true });
      }
      const [saved] = await sql`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        sql.json(results)
      }) as saved`;
      return Response.json({ processed: results.length, accepted: saved.saved });
    } catch {
      return Response.json({ error: "worker_failed" }, { status: 503 });
    }
  };
}
