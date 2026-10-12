import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import {
  createEntityType,
  getEntitySchema,
  getEntityType,
} from "../../functions/_shared/core/entity-types/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaChange,
  updateEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { createEntity, getEntity, updateEntity } from "../../functions/_shared/core/entity/application.ts";
import { compileEntityProperties } from "../../functions/_shared/core/entity-types/schema-rules.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { SchemaDefinition } from "../../functions/_shared/contracts/entity-schema-change.ts";
import type postgres from "postgres";
async function consume(worker: postgres.Sql) {
  for (let i = 0; i < 80; i++) {
    const batch = await worker.begin(async (tx) => {
      const [r] = await tx`select app.claim_entity_schema_analysis() as batch`;
      return r.batch;
    });
    if (!batch) return;
    const check = compileEntityProperties(batch.target as SchemaDefinition);
    const results = batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) => {
      try {
        check(r.properties);
        return { entity_id: r.entity_id, errors: [] };
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        return { entity_id: r.entity_id, errors: e.fields };
      }
    });
    await worker.begin(async (tx) => {
      await tx`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${tx.json(results)})`;
    });
  }
  throw new Error("analysis batch budget exhausted");
}
dbTest(
  "schema draft owner transaction: permanent reservations, async analysis, compatible display and stale writes",
  async () => {
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = connect(workerUrl.href, { prepare: false, max: 1 });
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 4 });
    const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(d, requestActor(a.actor), { label: "商品" });
      const other = await createEntityType(d, requestActor(a.actor), { label: "別" });
      const initial = await getEntitySchema(d, a.actor, { type_id: type.id });
      const entity = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 1,
        source: "app",
        external_id: crypto.randomUUID(),
        properties: { prop_1: "旧資料" },
      });
      const prototype = await createEntitySchemaChange(d, requestActor(a.actor), other.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{ op: "add_property", client_ref: "__proto__", field: { type: "string" }, required: false }, {
          op: "add_property",
          client_ref: "constructor",
          field: { type: "string" },
          required: false,
        }],
      });
      assertEquals(Object.entries(prototype.reservations), [["__proto__", "prop_2"], ["constructor", "prop_3"]]);
      const labels = JSON.parse('{"__proto__":"특수 코드","constructor":"생성 코드","toString":"문자 코드"}');
      const options = await createEntitySchemaChange(d, requestActor(a.actor), other.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "options",
          field: { type: "string", enum: Object.keys(labels) },
          required: false,
        }],
      });
      const withLabels = await updateEntitySchemaChange(d, requestActor(a.actor), other.id, options.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        expected_change_version: 1,
        edits: [...options.edits, {
          op: "set_display",
          display: { ...options.target.display, option_labels: { [options.reservations.options]: labels } },
        }],
      });
      assertEquals(withLabels.target.display.option_labels[options.reservations.options]["__proto__"], "특수 코드");
      assertEquals(
        (await getEntitySchemaChange(d, a.actor, other.id, options.id)).target.display
          .option_labels[options.reservations.options],
        labels,
      );
      const input = {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{ op: "add_property", client_ref: "cost", field: { type: "integer", title: "単価" }, required: false }],
      };
      const actor = requestActor(a.actor);
      const change = await createEntitySchemaChange(d, actor, type.id, input);
      assertEquals(change.reservations, { cost: "prop_2" });
      assertEquals(await createEntitySchemaChange(d, actor, type.id, input), change);
      assertEquals(
        (await assertRejects(async () =>
          await createEntitySchemaChange(d, actor, type.id, {
            ...input,
            edits: [{ op: "add_property", client_ref: "cost", field: { type: "string" }, required: false }],
          }), AppError)).code,
        "idempotency_key_reused",
      );
      assertEquals(
        (await assertRejects(
          async () => await createEntitySchemaChange(d, actor, type.id, { ...input, edits: [] }),
          AppError,
        ))
          .code,
        "invalid_input",
      );
      assertEquals(
        (await assertRejects(async () => await getEntitySchemaChange(d, b.actor, type.id, change.id), AppError)).code,
        "not_found",
      );
      assertEquals((await getEntitySchema(d, a.actor, { type_id: type.id })).schema_version, 1);
      const display = { ...change.target.display, list_columns: ["prop_1", "prop_2"] };
      const updated = await updateEntitySchemaChange(d, requestActor(a.actor), type.id, change.id, {
        ...input,
        expected_change_version: 1,
        edits: [...input.edits, {
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "商品名" },
          required: true,
        }, { op: "set_display", display }],
      });
      const analyzeActor = requestActor(a.actor);
      const accepted = await analyzeEntitySchemaChange(d, analyzeActor, type.id, change.id, {
        expected_change_version: updated.version,
      });
      assertEquals(accepted.status, "queued");
      assertEquals(accepted.change_id, change.id);
      assertEquals(
        await analyzeEntitySchemaChange(d, analyzeActor, type.id, change.id, {
          expected_change_version: updated.version,
        }),
        accepted,
      );
      assertEquals((await getEntitySchema(d, a.actor, { type_id: type.id })).schema_version, 1);
      await consume(worker);
      const ready = await getEntitySchemaChange(d, a.actor, type.id, change.id);
      assertEquals(ready.status, "ready");
      assertEquals(ready.analysis?.failed, 0);
      const applyInput = { expected_change_version: ready.version, analysis_id: ready.analysis!.id };
      const outcomes = await Promise.allSettled(
        [1, 2].map(() => applyEntitySchemaChange(d, requestActor(a.actor), type.id, change.id, applyInput)),
      );
      assertEquals(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      assertEquals((await getEntityType(d, a.actor, other.id)).schema_version, 1);
      const current = await getEntity(e, a.actor, entity.id);
      assertEquals(current.schema_version, 1);
      assertEquals(current.version, entity.version);
      assertEquals(current.title, "旧資料");
      assertEquals((await getEntitySchema(d, a.actor, { type_id: type.id })).schema.properties.prop_1.title, "商品名");
      assertEquals(
        (await assertRejects(async () =>
          await updateEntity(e, requestActor(a.actor), entity.id, {
            expected_version: entity.version,
            schema_version: 1,
            properties: { prop_1: "stale" },
          }), AppError)).code,
        "schema_changed",
      );
      const next = await createEntitySchemaChange(d, requestActor(a.actor), type.id, {
        expected_type_version: 2,
        expected_schema_version: 2,
        edits: [{ op: "add_property", client_ref: "next", field: { type: "string" }, required: false }],
      });
      assertEquals(next.reservations, { next: "prop_3" });
      const analyzed = await analyzeEntitySchemaChange(d, requestActor(a.actor), type.id, next.id, {
        expected_change_version: 1,
      });
      await consume(worker);
      await updateEntity(e, requestActor(a.actor), entity.id, {
        expected_version: entity.version,
        schema_version: 2,
        properties: { prop_2: 0 },
      });
      assertEquals((await getEntitySchemaChange(d, a.actor, type.id, next.id)).status, "stale");
      assertEquals(
        (await assertRejects(async () =>
          await applyEntitySchemaChange(d, requestActor(a.actor), type.id, next.id, {
            expected_change_version: 1,
            analysis_id: analyzed.analysis_id,
          }), AppError)).code,
        "schema_plan_stale",
      );
      const reservationRemoved = await updateEntitySchemaChange(d, requestActor(a.actor), type.id, next.id, {
        expected_type_version: 2,
        expected_schema_version: 2,
        expected_change_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "新しい表示" },
          required: true,
        }],
      });
      assertEquals(reservationRemoved.reservations, { next: "prop_3" });
      const reservedAfterDrop = await createEntitySchemaChange(d, requestActor(a.actor), type.id, {
        expected_type_version: 2,
        expected_schema_version: 2,
        edits: [{ op: "add_property", client_ref: "after", field: { type: "string" }, required: false }],
      });
      assertEquals(reservedAfterDrop.reservations, { after: "prop_4" });
      const narrowed = await createEntitySchemaChange(d, requestActor(a.actor), type.id, {
        expected_type_version: 2,
        expected_schema_version: 2,
        edits: [{ op: "update_property", key: "prop_2", field: { type: "integer", minimum: 1 }, required: false }],
      });
      assertEquals(narrowed.change_kind, "migration_required");
      await analyzeEntitySchemaChange(d, requestActor(a.actor), type.id, narrowed.id, { expected_change_version: 1 });
      await consume(worker);
      const failures = await getEntitySchemaChange(d, a.actor, type.id, narrowed.id);
      assertEquals(failures.analysis?.failed, 1);
      assertEquals(failures.analysis?.errors[0].entity_id, entity.id);
      const settings = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
      await updateBusinessSettings(settings, requestActor(a.actor), {
        id: "record_templates",
        expected_version: 0,
        value: { entity: { update: { memo: "$엔터티.이후.prop_2$", tag_ids: [] } } },
      });
      for (const op of ["archive_property", "remove_property"]) {
        const error = await assertRejects(
          async () =>
            await createEntitySchemaChange(d, requestActor(a.actor), type.id, {
              expected_type_version: 2,
              expected_schema_version: 2,
              edits: [{ op, key: "prop_2" }],
            }),
          AppError,
        );
        assertEquals(error.code, "invalid_input");
        assertEquals(error.fields?.[0].path, "record_templates.entity.update.memo");
      }
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
      await worker.end();
    }
  },
);

dbTest(
  "schema draft races: concurrent reservations never reuse keys and publication competes with an actual value write",
  async () => {
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = connect(workerUrl.href, { prepare: false, max: 1 }),
      admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 4 });
    const owner = await fixtureOwner(admin);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(d, requestActor(owner.actor), { label: "競争対象" });
      const other = await createEntityType(d, requestActor(owner.actor), { label: "独立対象" });
      const drafts = await Promise.all(
        ["first", "second"].map((ref) =>
          createEntitySchemaChange(d, requestActor(owner.actor), type.id, {
            expected_type_version: 1,
            expected_schema_version: 1,
            edits: [{ op: "add_property", client_ref: ref, field: { type: "string", title: ref }, required: false }],
          })
        ),
      );
      assertEquals(drafts.map((change) => Object.values(change.reservations)[0]).sort(), ["prop_2", "prop_3"]);
      const independent = await createEntitySchemaChange(d, requestActor(owner.actor), other.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{ op: "add_property", client_ref: "independent", field: { type: "string" }, required: false }],
      });
      assertEquals(independent.reservations, { independent: "prop_2" });
      const initial = await getEntitySchema(d, owner.actor, { type_id: type.id });
      const removed = await updateEntitySchemaChange(d, requestActor(owner.actor), type.id, drafts[0].id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        expected_change_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "削除した追加とは別の変更" },
          required: true,
        }],
      });
      assertEquals(Object.keys(removed.target.schema.properties), ["prop_1"]);
      assertEquals(removed.reservations, drafts[0].reservations);
      const after = await createEntitySchemaChange(d, requestActor(owner.actor), type.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{ op: "add_property", client_ref: "after-drop", field: { type: "string" }, required: false }],
      });
      assertEquals(after.reservations, { "after-drop": "prop_4" });
      const entity = await createEntity(e, requestActor(owner.actor), {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "original value" },
      });
      const publication = await createEntitySchemaChange(d, requestActor(owner.actor), type.id, {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "Published label" },
          required: true,
        }],
      });
      const accepted = await analyzeEntitySchemaChange(d, requestActor(owner.actor), type.id, publication.id, {
        expected_change_version: publication.version,
      });
      await consume(worker);
      assertEquals((await getEntitySchemaChange(d, owner.actor, type.id, publication.id)).status, "ready");
      const results = await Promise.allSettled([
        applyEntitySchemaChange(d, requestActor(owner.actor), type.id, publication.id, {
          expected_change_version: publication.version,
          analysis_id: accepted.analysis_id,
        }),
        updateEntity(e, requestActor(owner.actor), entity.id, {
          schema_version: 1,
          expected_version: entity.version,
          properties: { prop_1: "racing value" },
        }),
      ]);
      assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
      const current = await getEntity(e, owner.actor, entity.id),
        schema = await getEntitySchema(d, owner.actor, { type_id: type.id });
      const failed = results.find((result) => result.status === "rejected");
      if (!failed || failed.status !== "rejected" || !(failed.reason instanceof AppError)) {
        throw new Error("race must return one public business conflict");
      }
      if (results[0].status === "fulfilled") {
        assertEquals(failed.reason.code, "schema_changed");
        assertEquals([schema.schema_version, current.schema_version, current.version, current.properties.prop_1], [
          2,
          1,
          entity.version,
          "original value",
        ]);
        assertEquals(schema.schema.properties.prop_1.title, "Published label");
      } else {
        assertEquals(failed.reason.code, "schema_plan_stale");
        assertEquals([schema.schema_version, current.schema_version, current.version, current.properties.prop_1], [
          1,
          1,
          entity.version + 1,
          "racing value",
        ]);
        assertEquals(schema.schema.properties.prop_1.title, "이름");
      }
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
      await worker.end();
    }
  },
);
