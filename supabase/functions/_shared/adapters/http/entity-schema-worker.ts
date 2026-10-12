import postgres from "postgres";
import { z } from "zod";
import { compileEntityProperties } from "../../core/entity-types/schema-rules.ts";
import { AppError } from "../../core/shared/errors.ts";
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
      const check = compileEntityProperties(batch.target);
      const results = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) => {
        try {
          check(row.properties);
          return { entity_id: row.entity_id, errors: [] };
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
          return { entity_id: row.entity_id, errors: e.fields ?? [{ path: "properties", message: e.message }] };
        }
      });
      const [saved] = await sql`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        sql.json(results)
      }) as saved`;
      return Response.json({ processed: results.length, accepted: saved.saved });
    } catch {
      return Response.json({ error: "worker_failed" }, { status: 503 });
    }
  };
}
