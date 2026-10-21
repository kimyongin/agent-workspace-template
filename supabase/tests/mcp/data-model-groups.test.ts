import { assert, assertEquals } from "@std/assert";
import postgres from "postgres";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { grantOwnedKinds } from "./_workspace-grants.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { definitionFingerprint } from "../../functions/_shared/core/entity-types/evolution.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
activityWorkspaceSuite(
  "whole model group actual HTTP/OAuth MCP: analysis, cancellation, durable acceptance, retry and exact replay after commit",
  async ({ A: token, B: foreign, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const url = new URL(Deno.env.get("LOCAL_DB_URL")!);
    url.username = "app_worker";
    url.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = postgres(url.href, {
      max: 1,
      prepare: false,
      onnotice: () => {},
      connection: { statement_timeout: 15000 },
    });
    const compact = (value: unknown) => {
      assert(value !== null && typeof value === "object");
      assertEquals(Object.hasOwn(value, "plan"), false);
      assert(new TextEncoder().encode(JSON.stringify(value)).length < 100000);
    };
    const typeIds: string[] = [];
    const key = () => crypto.randomUUID();
    try {
      const initial = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      initial.entity_types = initial.entity_types.slice(0, 2);
      initial.relations = [];
      for (const t of initial.entity_types) {
        t.schema.title += ` ${crypto.randomUUID().slice(0, 8)}`;
        t.schema.properties.prop_4 = { ...t.schema.properties.prop_3, "x-order": 40 };
        t.schema.required = [...t.schema.required.filter((key) => key !== "prop_3"), "prop_4"];
        t.schema["x-identity-property"] = "prop_4";
        t.schema.properties.prop_2 = { type: "string", title: "수량", "x-order": 20 };
        t.schema.properties.prop_3 = {
          type: "string",
          title: "참고 원문",
          "x-order": 30,
          examples: Array.from({ length: 45 }, () => "x".repeat(4096)),
        };
      }
      const input = { mode: "copy", document: JSON.stringify(initial) },
        preview = await scopedTool(client, w, "preview_data_model", input);
      assertEquals(preview.error, undefined);
      typeIds.push(...Object.values(preview.mapping.types) as string[]);
      const prepared = await scopedTool(client, w, "prepare_data_model", {
        ...input,
        preview_fingerprint: preview.fingerprint,
        request_key: key(),
      });
      const applied = await scopedTool(client, w, "apply_data_model", {
        id: prepared.id,
        expected_version: prepared.version,
        request_key: key(),
      });
      assertEquals(applied.status, "applied");
      await grantOwnedKinds(token, w, typeIds);
      const entities = [];
      for (const [index, id] of typeIds.entries()) {
        entities.push(
          await scopedTool(client, w, "create_entity", {
            entity_type_id: id,
            schema_version: 1,
            properties: { prop_1: `대상${index}`, prop_2: String(index + 8) },
            request_key: key(),
          }),
        );
      }
      const target = await scopedTool(client, w, "export_data_model", {}) as DataModelDocument;
      target.entity_types = target.entity_types.filter((t) => typeIds.includes(t.schema["x-type-id"]));
      target.relations = [];
      for (const t of target.entity_types) {
        t.schema.properties.prop_2 = { type: "integer", title: "수량", "x-order": 20 };
      }
      const update = { mode: "update", document: JSON.stringify(target) },
        review = await scopedTool(client, w, "preview_data_model", update);
      const conversions = target.entity_types.map((t) => ({
        type_ref: t.ref,
        migration: { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] },
      }));
      const analyzed = async () => {
        const c = await scopedTool(client, w, "prepare_data_model", {
          ...update,
          preview_fingerprint: review.fingerprint,
          request_key: key(),
        });
        const input = { expected_version: c.version, conversions }, requestKey = key();
        const accepted = await scopedTool(client, w, "analyze_data_model", {
          id: c.id,
          ...input,
          request_key: requestKey,
        });
        compact(accepted);
        assertEquals(accepted.status, "analyzing");
        const replay = await scopedHttp(token, w, "POST", `/data-model/changes/${c.id}/analyze`, input, requestKey);
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
        const ready = await scopedTool(client, w, "get_data_model_change", { id: c.id });
        assertEquals(ready.status, "ready");
        assert(new TextEncoder().encode(JSON.stringify(ready)).length > 1024 * 1024);
        for (const child of ready.group.children) {
          assertEquals(
            child.source.schema.properties.prop_3.examples,
            Array.from({ length: 45 }, () => "x".repeat(4096)),
          );
          assertEquals(child.change.target.schema.properties.prop_3.examples[0].length, 4096);
        }
        assertEquals(Object.hasOwn(ready, "plan"), false);
        return ready;
      };
      const cancelled = await analyzed(), cancelInput = { expected_version: cancelled.version }, cancelKey = key();
      const cancel = await scopedTool(client, w, "cancel_data_model", {
        id: cancelled.id,
        ...cancelInput,
        request_key: cancelKey,
      });
      compact(cancel);
      assertEquals(cancel.status, "cancelled");
      const cancelReplay = await scopedHttp(
        token,
        w,
        "POST",
        `/data-model/changes/${cancelled.id}/cancel`,
        cancelInput,
        cancelKey,
      );
      assertEquals(cancelReplay.status, 200);
      assertEquals(await definitionFingerprint(cancelReplay.body), await definitionFingerprint(cancel));
      const ready = await analyzed(), applyInput = { expected_version: ready.version }, applyKey = key();
      const queued = await scopedTool(client, w, "apply_data_model", {
        id: ready.id,
        ...applyInput,
        request_key: applyKey,
      });
      compact(queued);
      assertEquals(queued.status, "queued");
      assertEquals((await scopedHttp(foreign, otherW, "GET", `/data-model/changes/${ready.id}`)).status, 404);
      const accepted = await scopedHttp(
        token,
        w,
        "POST",
        `/data-model/changes/${ready.id}/apply`,
        applyInput,
        applyKey,
      );
      assertEquals(await definitionFingerprint(accepted.body), await definitionFingerprint(queued));
      const [claimed] = await worker`select app.claim_data_model_conversion() as batch`, batch = claimed.batch;
      await worker`select app.fail_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},'migration_worker_failed',true)`;
      const failed = await scopedTool(client, w, "get_data_model_change", { id: ready.id });
      assertEquals(failed.status, "failed");
      const jobIds = failed.group.children.map((c: { job: { id: string } }) => c.job.id),
        retryInput = { expected_version: failed.version },
        retryKey = key();
      const retry = await scopedTool(client, w, "retry_data_model", {
        id: ready.id,
        ...retryInput,
        request_key: retryKey,
      });
      compact(retry);
      assertEquals(retry.status, "queued");
      const retryDetail = await scopedTool(client, w, "get_data_model_change", { id: ready.id });
      const retryJobIds = retryDetail.group.children.map((child: { job: { id: string } }) => child.job.id);
      assertEquals(retryJobIds.length, jobIds.length);
      assert(jobIds.every((id: string) => !retryJobIds.includes(id)));
      const retryReplay = await scopedHttp(
        token,
        w,
        "POST",
        `/data-model/changes/${ready.id}/retry`,
        retryInput,
        retryKey,
      );
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
      const done = await scopedTool(client, w, "get_data_model_change", { id: ready.id });
      assertEquals(done.status, "applied");
      assertEquals(done.group.children.map((c: { job: { id: string } }) => c.job.id), retryJobIds);
      const final = await scopedHttp(token, w, "GET", `/data-model/changes/${ready.id}`);
      assertEquals(await definitionFingerprint(final.body), await definitionFingerprint(done));
      const replay = await scopedTool(client, w, "apply_data_model", {
        id: ready.id,
        ...applyInput,
        request_key: applyKey,
      });
      assertEquals(await definitionFingerprint(replay), await definitionFingerprint(queued));
      for (const [index, e] of entities.entries()) {
        assertEquals((await scopedTool(client, w, "get_entity", { id: e.id })).properties, {
          ...e.properties,
          prop_2: index + 8,
        });
      }
    } finally {
      await worker.end();
    }
  },
  { mcp: true },
);
