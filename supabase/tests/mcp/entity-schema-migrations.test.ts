import { assert, assertEquals } from "@std/assert";
import postgres from "postgres";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/adapters/http/schema-migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
httpTest(
  "migration jobs HTTP/MCP: fixed 202 acceptance replay, owner reads, cancel/retry versions and same-key replay after success",
  async () => {
    const token = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(token));
    const url = new URL(Deno.env.get("LOCAL_DB_URL")!);
    url.username = "app_worker";
    url.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = postgres(url.href, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      connection: { statement_timeout: 15000 },
    });
    let typeId: string | undefined, entityId: string | undefined;
    try {
      const type = (await call(token, "POST", "/entity-types", { label: "job parity " + crypto.randomUUID() })).body;
      typeId = type.id;
      const entity = (await call(token, "POST", "/entities", {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: "source" },
      })).body;
      entityId = entity.id;
      const plan = (await call(token, "POST", `/entity-types/${typeId}/schema-changes`, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "flag",
          field: { type: "boolean", title: "確認" },
          required: true,
        }],
        migration: { rules: [{ op: "fill", key: "prop_2", value: false }], overrides: [] },
      })).body;
      await call(token, "POST", `/entity-types/${typeId}/schema-changes/${plan.id}/analyze`, {
        expected_change_version: 1,
      });
      for (let i = 0; i < 4; i++) {
        const [r] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!r.batch) break;
        const b = r.batch, convert = compileMigration(b.target, b.migration);
        await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
          worker.json(b.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(r.entity_id, r.properties)
          ))
        })`;
      }
      const ready = (await call(token, "GET", `/entity-types/${typeId}/schema-changes/${plan.id}`)).body;
      assert(ready.executable);
      const input = {
          expected_type_version: 1,
          expected_schema_version: 1,
          expected_change_version: 1,
          analysis_id: ready.analysis.id,
          fingerprint: ready.fingerprint,
        },
        path = `/entity-types/${typeId}/schema-changes/${plan.id}/migrations`,
        key = crypto.randomUUID();
      assertEquals((await call(token, "POST", path, input, null)).status, 400);
      assertEquals((await call(token, "POST", path, { ...input, owner_id: "invented" })).status, 400);
      const accepted = await call(token, "POST", path, input, key);
      assertEquals(accepted.status, 202);
      assertEquals(Object.keys(accepted.body).sort(), [
        "analysis_id",
        "change_id",
        "job_id",
        "job_version",
        "status",
        "type_id",
      ]);
      assertEquals(
        await tool(client, "start_entity_schema_migration", {
          type_id: typeId,
          change_id: plan.id,
          ...input,
          request_key: key,
        }),
        accepted.body,
      );
      const jobId = accepted.body.job_id, job = (await call(token, "GET", `/entity-schema-migrations/${jobId}`)).body;
      assertEquals(await tool(client, "get_entity_schema_migration", { job_id: jobId }), job);
      assertEquals((await call(other, "GET", `/entity-schema-migrations/${jobId}`)).status, 404);
      assertEquals(
        await tool(client, "list_entity_schema_migrations", { type_id: typeId }),
        (await call(token, "GET", `/entity-schema-migrations?type_id=${typeId}`)).body,
      );
      const cancellation = await tool(client, "cancel_entity_schema_migration", {
        job_id: jobId,
        expected_job_version: job.version,
        request_key: crypto.randomUUID(),
      });
      assertEquals(cancellation.status, "cancelled");
      assertEquals((await call(token, "GET", `/entity-schema-migrations/${jobId}`)).body, cancellation);
      assertEquals(
        (await call(token, "POST", `/entity-schema-migrations/${jobId}/retry`, {
          expected_job_version: cancellation.version,
        })).status,
        409,
      );
      assertEquals((await call(token, "POST", path, input)).status, 409);
      const reanalysis = await call(token, "POST", `/entity-types/${typeId}/schema-changes/${plan.id}/analyze`, {
        expected_change_version: 1,
      });
      for (let i = 0; i < 4; i++) {
        const [r] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!r.batch) break;
        const b = r.batch, convert = compileMigration(b.target, b.migration);
        await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
          worker.json(b.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(r.entity_id, r.properties)
          ))
        })`;
      }
      input.analysis_id = reanalysis.body.analysis_id;
      const secondKey = crypto.randomUUID(),
        second = await call(token, "POST", path, input, secondKey),
        secondId = second.body.job_id;
      const [claimed] = await worker`select app.claim_entity_schema_migration() as batch`;
      assertEquals(claimed.batch.id, secondId);
      await worker`select app.fail_entity_schema_migration(${secondId},${claimed.batch.fence},'migration_worker_failed',true)`;
      const failed = (await call(token, "GET", `/entity-schema-migrations/${secondId}`)).body;
      assertEquals(failed.status, "failed");
      assert(failed.retryable);
      const retryKey = crypto.randomUUID(),
        retried = await call(token, "POST", `/entity-schema-migrations/${secondId}/retry`, {
          expected_job_version: failed.version,
        }, retryKey);
      assertEquals(retried.status, 202);
      assertEquals(retried.body.job_id, secondId);
      assertEquals(
        await tool(client, "retry_entity_schema_migration", {
          job_id: secondId,
          expected_job_version: failed.version,
          request_key: retryKey,
        }),
        retried.body,
      );
      for (let i = 0; i < 4; i++) {
        const [r] = await worker`select app.claim_entity_schema_migration() as batch`;
        assertEquals(r.batch.id, secondId);
        const b = r.batch;
        if (b.status === "committing") {
          await worker`select app.commit_entity_schema_migration(${b.id},${b.fence},${b.source_template_fingerprint},${SEARCH_PIPELINE})`;
          break;
        }
        const prepared = await prepareMigrationBatch(b);
        await worker`select app.stage_entity_schema_migration(${b.id},${b.fence},${worker.json(prepared.results)})`;
      }
      const done = (await call(token, "GET", `/entity-schema-migrations/${secondId}`)).body;
      assertEquals(done.status, "succeeded");
      assertEquals(await tool(client, "get_entity_schema_migration", { job_id: secondId }), done);
      const replay = await call(token, "POST", path, input, secondKey);
      assertEquals(replay.status, 202);
      assertEquals(replay.body, second.body);
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      assertEquals((await call(token, "GET", `/entities/${encodeURIComponent(entityId!)}`)).body.properties, {
        prop_1: "source",
        prop_2: false,
      });
      const recoveryPath = `/entity-schema-migrations/${secondId}/recovery-changes`;
      const refs = {
        expected_job_version: done.version,
        expected_type_version: done.recovery.current_type_version,
        expected_schema_version: done.recovery.current_schema_version,
      };
      assertEquals(done.recovery.status, "available");
      assertEquals((await call(token, "POST", recoveryPath, refs, null)).status, 400);
      assertEquals((await call(other, "POST", recoveryPath, refs)).status, 404);
      assertEquals((await call(token, "POST", recoveryPath, { ...refs, target: {} })).status, 400);
      const recoveryKey = crypto.randomUUID(), draft = await call(token, "POST", recoveryPath, refs, recoveryKey);
      assertEquals(draft.status, 201);
      assertEquals(draft.body.status, "draft");
      assertEquals(
        await tool(client, "create_entity_schema_recovery", { job_id: secondId, ...refs, request_key: recoveryKey }),
        draft.body,
      );
      assertEquals(
        (await call(token, "GET", `/entities/${encodeURIComponent(entityId!)}`)).body.properties.prop_2,
        false,
      );
      const recoveryAnalysis = await tool(client, "analyze_entity_schema_change", {
        type_id: typeId,
        change_id: draft.body.id,
        expected_change_version: 1,
        request_key: crypto.randomUUID(),
      });
      assertEquals(recoveryAnalysis.status, "queued");
      for (let n = 0; n < 4; n++) {
        const [r] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!r.batch) break;
        const b = r.batch, convert = compileMigration(b.target, b.migration, b.recovery_keys);
        await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
          worker.json(
            b.rows.map((
              r: {
                entity_id: string;
                properties: Record<string, unknown>;
                recovery_properties: Record<string, unknown>;
              },
            ) => convert(r.entity_id, r.properties, r.recovery_properties)),
          )
        })`;
      }
      const recoveredPlan = (await call(token, "GET", `/entity-types/${typeId}/schema-changes/${draft.body.id}`)).body;
      assert(recoveredPlan.executable);
      const rows = await tool(client, "list_entity_schema_analysis_rows", {
        type_id: typeId,
        change_id: draft.body.id,
        analysis_id: recoveredPlan.analysis.id,
      });
      assertEquals(rows.items[0].after, { prop_1: "source" });
      const recovered = await tool(client, "start_entity_schema_migration", {
        type_id: typeId,
        change_id: draft.body.id,
        expected_change_version: 1,
        expected_type_version: refs.expected_type_version,
        expected_schema_version: refs.expected_schema_version,
        analysis_id: recoveredPlan.analysis.id,
        fingerprint: recoveredPlan.fingerprint,
        request_key: crypto.randomUUID(),
      });
      for (let n = 0; n < 4; n++) {
        const [r] = await worker`select app.claim_entity_schema_migration() as batch`;
        const b = r.batch;
        assertEquals(b.id, recovered.job_id);
        if (b.status === "committing") {
          await worker`select app.commit_entity_schema_migration(${b.id},${b.fence},${b.source_template_fingerprint},${SEARCH_PIPELINE})`;
          break;
        }
        const prepared = await prepareMigrationBatch(b);
        await worker`select app.stage_entity_schema_migration(${b.id},${b.fence},${worker.json(prepared.results)})`;
      }
      assertEquals(
        (await call(token, "GET", `/entity-schema-migrations/${recovered.job_id}`)).body.status,
        "succeeded",
      );
      assertEquals((await call(token, "GET", `/entities/${encodeURIComponent(entityId!)}`)).body.properties, {
        prop_1: "source",
      });
      const newer = (await call(token, "GET", `/entity-schema-migrations/${recovered.job_id}`)).body;
      await call(token, "PATCH", `/entities/${encodeURIComponent(entityId!)}`, {
        expected_version: 3,
        schema_version: 3,
        properties: { prop_1: "later value" },
      });
      const staleRefs = {
        expected_job_version: newer.version,
        expected_type_version: newer.recovery.current_type_version,
        expected_schema_version: newer.recovery.current_schema_version,
      };
      const staleHttp = await call(
        token,
        "POST",
        `/entity-schema-migrations/${recovered.job_id}/recovery-changes`,
        staleRefs,
      );
      assertEquals(staleHttp.status, 409);
      assertEquals(staleHttp.body.code, "schema_plan_stale");
      const staleMcp = await tool(client, "create_entity_schema_recovery", { job_id: recovered.job_id, ...staleRefs });
      assertEquals(staleMcp.error.code, "schema_plan_stale");
      await admin`update app.entity_schema_migrations set source_expires_at=now()-interval '1 second' where id=${recovered.job_id}`;
      const expiredHttp = await call(
        token,
        "POST",
        `/entity-schema-migrations/${recovered.job_id}/recovery-changes`,
        staleRefs,
      );
      assertEquals(expiredHttp.status, 410);
      assertEquals(expiredHttp.body.code, "migration_source_expired");
      assertEquals(
        (await tool(client, "create_entity_schema_recovery", { job_id: recovered.job_id, ...staleRefs })).error.code,
        "migration_source_expired",
      );
    } finally {
      await client.close();
      await worker.end();
      if (entityId) await admin`delete from app.records where entity_ids@>array[${entityId}]`;
      if (entityId) await admin`delete from app.entities where id=${entityId}`;
      if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    }
  },
);
