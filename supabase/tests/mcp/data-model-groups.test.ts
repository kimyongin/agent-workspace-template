import { assert, assertEquals } from "@std/assert";
import postgres from "postgres";
import { admin, call, httpTest, signIn, SUPABASE_URL } from "../http/_client.ts";
import { claimsOf, connectMcp, mcpGrant, tool } from "./_mcp.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { definitionFingerprint } from "../../functions/_shared/core/entity-types/evolution.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
httpTest(
  "whole model group actual HTTP/OAuth MCP: analysis, cancellation, durable acceptance, retry and exact replay after commit",
  async () => {
    const token = await signIn("A"),
      foreign = await signIn("B"),
      owner = String(claimsOf(token).sub),
      grant = await mcpGrant(token),
      client = await connectMcp(grant.access_token);
    const url = new URL(Deno.env.get("LOCAL_DB_URL")!);
    url.username = "app_worker";
    url.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = postgres(url.href, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      connection: { statement_timeout: 15000 },
    });
    const keys: string[] = [], changes: string[] = [], typeIds: string[] = [], errors: unknown[] = [];
    const key = () => {
      const value = crypto.randomUUID();
      keys.push(value);
      return value;
    };
    const remember = (id: unknown) => {
      if (typeof id === "string" && !changes.includes(id)) changes.push(id);
    };
    try {
      const initial = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      initial.entity_types = initial.entity_types.slice(0, 2);
      initial.relations = [];
      for (const t of initial.entity_types) {
        t.schema.title += ` ${crypto.randomUUID().slice(0, 8)}`;
        t.schema.properties.prop_2 = { type: "string", title: "수량", "x-order": 20 };
      }
      const input = { mode: "copy", document: JSON.stringify(initial) },
        preview = await tool(client, "preview_data_model", input);
      typeIds.push(...Object.values(preview.mapping.types) as string[]);
      const prepared = await tool(client, "prepare_data_model", {
        ...input,
        preview_fingerprint: preview.fingerprint,
        request_key: key(),
      });
      remember(prepared.id);
      const applied = await tool(client, "apply_data_model", {
        id: prepared.id,
        expected_version: prepared.version,
        request_key: key(),
      });
      assertEquals(applied.status, "applied");
      const entities = [];
      for (const [index, id] of typeIds.entries()) {
        entities.push(
          await tool(client, "create_entity", {
            entity_type_id: id,
            schema_version: 1,
            properties: { prop_1: `대상${index}`, prop_2: String(index + 8) },
            request_key: key(),
          }),
        );
      }
      const target = await tool(client, "export_data_model", {}) as DataModelDocument;
      target.entity_types = target.entity_types.filter((t) => typeIds.includes(t.schema["x-type-id"]));
      target.relations = [];
      for (const t of target.entity_types) {
        t.schema.properties.prop_2 = { type: "integer", title: "수량", "x-order": 20 };
      }
      const update = { mode: "update", document: JSON.stringify(target) },
        review = await tool(client, "preview_data_model", update);
      const conversions = target.entity_types.map((t) => ({
        type_ref: t.ref,
        migration: { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] },
      }));
      const analyzed = async () => {
        const c = await tool(client, "prepare_data_model", {
          ...update,
          preview_fingerprint: review.fingerprint,
          request_key: key(),
        });
        remember(c.id);
        const input = { expected_version: c.version, conversions }, requestKey = key();
        const accepted = await tool(client, "analyze_data_model", { id: c.id, ...input, request_key: requestKey });
        assertEquals(accepted.status, "analyzing");
        const replay = await call(token, "POST", `/data-model/changes/${c.id}/analyze`, input, requestKey);
        assertEquals(replay.status, 200);
        assertEquals(await definitionFingerprint(replay.body), await definitionFingerprint(accepted));
        for (let n = 0; n < 10; n++) {
          const [r] = await worker`select app.claim_entity_schema_analysis() as batch`;
          if (!r.batch) break;
          const b = r.batch, convert = compileMigration(b.target, b.migration, b.recovery_keys);
          const rows = b.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(r.entity_id, r.properties)
          );
          await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${worker.json(rows)})`;
        }
        const ready = await tool(client, "get_data_model_change", { id: c.id });
        assertEquals(ready.status, "ready");
        return ready;
      };
      const cancelled = await analyzed(), cancelInput = { expected_version: cancelled.version }, cancelKey = key();
      const cancel = await tool(client, "cancel_data_model", {
        id: cancelled.id,
        ...cancelInput,
        request_key: cancelKey,
      });
      assertEquals(cancel.status, "cancelled");
      const cancelReplay = await call(
        token,
        "POST",
        `/data-model/changes/${cancelled.id}/cancel`,
        cancelInput,
        cancelKey,
      );
      assertEquals(cancelReplay.status, 200);
      assertEquals(await definitionFingerprint(cancelReplay.body), await definitionFingerprint(cancel));
      const ready = await analyzed(), applyInput = { expected_version: ready.version }, applyKey = key();
      const queued = await tool(client, "apply_data_model", { id: ready.id, ...applyInput, request_key: applyKey });
      assertEquals(queued.status, "queued");
      assertEquals((await call(foreign, "GET", `/data-model/changes/${ready.id}`)).status, 404);
      const accepted = await call(token, "POST", `/data-model/changes/${ready.id}/apply`, applyInput, applyKey);
      assertEquals(await definitionFingerprint(accepted.body), await definitionFingerprint(queued));
      const [claimed] = await worker`select app.claim_data_model_conversion() as batch`, batch = claimed.batch;
      await worker`select app.fail_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},'migration_worker_failed',true)`;
      const failed = await tool(client, "get_data_model_change", { id: ready.id });
      assertEquals(failed.status, "failed");
      const jobIds = failed.group.children.map((c: { job: { id: string } }) => c.job.id),
        retryInput = { expected_version: failed.version },
        retryKey = key();
      const retry = await tool(client, "retry_data_model", { id: ready.id, ...retryInput, request_key: retryKey });
      assertEquals(retry.status, "queued");
      const retryReplay = await call(token, "POST", `/data-model/changes/${ready.id}/retry`, retryInput, retryKey);
      assertEquals(await definitionFingerprint(retryReplay.body), await definitionFingerprint(retry));
      for (let n = 0; n < 20; n++) {
        const [r] = await worker`select app.claim_data_model_conversion() as batch`;
        if (!r.batch) break;
        const b = r.batch;
        if (b.status === "committing") {
          const [done] =
            await worker`select app.commit_data_model_conversion(${b.id},${b.fence},${SEARCH_PIPELINE}) as committed`;
          assertEquals(done.committed, true);
        } else {
          const values = await prepareMigrationBatch(b.child, new Date());
          const [stage] =
            await worker`select app.stage_data_model_conversion(${b.id},${b.fence},${b.child.id},${b.child.fence},${
              worker.json(values.results)
            }) as accepted`;
          assertEquals(stage.accepted, true);
        }
      }
      const done = await tool(client, "get_data_model_change", { id: ready.id });
      assertEquals(done.status, "applied");
      assertEquals(done.group.children.map((c: { job: { id: string } }) => c.job.id), jobIds);
      const final = await call(token, "GET", `/data-model/changes/${ready.id}`);
      assertEquals(await definitionFingerprint(final.body), await definitionFingerprint(done));
      const replay = await tool(client, "apply_data_model", { id: ready.id, ...applyInput, request_key: applyKey });
      assertEquals(await definitionFingerprint(replay), await definitionFingerprint(queued));
      for (const [index, e] of entities.entries()) {
        assertEquals((await tool(client, "get_entity", { id: e.id })).properties.prop_2, index + 8);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await admin.begin(async (tx) => {
          const retained =
            await tx`select result->>'id' as id from private.request_results where owner_id=${owner}::uuid and request_key=any(${keys}::uuid[]) and operation='data-model.prepare'`;
          for (const row of retained) remember(row.id);
          const entities =
              await tx`select id from app.entities where owner_id=${owner}::uuid and entity_type_id=any(${typeIds}::uuid[])`,
            entityIds = entities.map((e) => String(e.id));
          const records =
              await tx`select id from app.records where owner_id=${owner}::uuid and (entity_ids&&${entityIds}::text[] or change_metadata->>'target_id'=any(${entityIds}::text[]))`,
            recordIds = records.map((r) => String(r.id));
          await tx`delete from private.request_results where owner_id=${owner}::uuid and request_key=any(${keys}::uuid[])`;
          await tx`delete from pgmq.q_search_index where message->>'owner_id'=${owner} and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from pgmq.a_search_index where message->>'owner_id'=${owner} and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from private.passage_effects where owner_id=${owner}::uuid and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_chunks where owner_id=${owner}::uuid and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_index_state where owner_id=${owner}::uuid and kind='record' and id=any(${recordIds}::text[])`;
          await tx`delete from app.records where owner_id=${owner}::uuid and id=any(${recordIds}::text[])`;
          await tx`delete from app.data_model_changes where owner_id=${owner}::uuid and id=any(${changes}::uuid[])`;
          await tx`delete from app.entities where owner_id=${owner}::uuid and id=any(${entityIds}::text[])`;
          await tx`delete from app.entity_types where owner_id=${owner}::uuid and id=any(${typeIds}::uuid[])`;
        });
      } catch (error) {
        errors.push(error);
      }
      try {
        await client.close();
        await worker.end();
      } catch (error) {
        errors.push(error);
      }
      try {
        const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
        assert(secret);
        const removed = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(grant.client_id)}`,
          {
            method: "DELETE",
            headers: { apikey: secret, authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(15000),
          },
        );
        await removed.body?.cancel();
        assert(removed.ok || removed.status === 404);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "whole model group contract or exact fixture cleanup failed");
  },
);
