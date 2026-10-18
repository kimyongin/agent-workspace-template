import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
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
  getEntitySchemaAnalysisRows,
  getEntitySchemaChange,
  updateEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import type { SchemaDefinition } from "../../functions/_shared/contracts/entity-schema-change.ts";
import type postgres from "postgres";
async function consume(worker: postgres.Sql) {
  for (let i = 0; i < 80; i++) {
    const batch = await worker.begin(async (tx) => {
      const [r] = await tx`select app.claim_entity_schema_analysis() as batch`;
      return r.batch;
    });
    if (!batch) return;
    const convert = compileMigration(batch.target as SchemaDefinition, batch.migration);
    const results = batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
      convert(r.entity_id, r.properties)
    );
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
    const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await a.createKind("商品");
      await a.grantKind(a.manager, type.id, "write");
      const other = await a.createKind("別");
      await a.grantKind(a.manager, other.id, "write");
      const initial = await getEntitySchema(d, a.manager, { type_id: type.id });
      const entity = await createEntity(e, requestActor(a.manager), {
        entity_type_id: type.id,
        schema_version: 1,
        source: "app",
        external_id: crypto.randomUUID(),
        properties: { prop_1: "旧資料" },
      });
      const prototype = await createEntitySchemaChange(d, requestActor(a.manager), other.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "__proto__",
          field: { "x-order": 20, type: "string" },
          required: false,
        }, {
          op: "add_property",
          client_ref: "constructor",
          field: { "x-order": 30, type: "string" },
          required: false,
        }],
      });
      assertEquals(Object.entries(prototype.reservations), [["__proto__", "prop_2"], ["constructor", "prop_3"]]);
      const labels: Record<string, string> = JSON.parse(
        '{"__proto__":"특수 코드","constructor":"생성 코드","toString":"문자 코드"}',
      );
      const options = await createEntitySchemaChange(d, requestActor(a.manager), other.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "options",
          field: { "x-order": 20, type: "string", oneOf: Object.keys(labels).map((value) => ({ const: value })) },
          required: false,
        }],
      });
      const withLabels = await updateEntitySchemaChange(d, requestActor(a.manager), other.id, options.id, {
        expected_schema_version: 1,
        expected_change_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "options",
          field: {
            "x-order": 20,
            type: "string",
            oneOf: Object.entries(labels).map(([value, title]) => ({ const: value, title })),
          },
          required: false,
        }],
      });
      assertEquals(
        withLabels.target.schema.properties[options.reservations.options].oneOf?.find((option) =>
          option.const === "__proto__"
        )?.title,
        "특수 코드",
      );
      assertEquals(
        (await getEntitySchemaChange(d, a.manager, other.id, options.id)).target.schema
          .properties[options.reservations.options].oneOf,
        Object.entries(labels).map(([value, title]) => ({ const: value, title })),
      );
      const input = {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "cost",
          field: { "x-order": 20, type: "integer", title: "単価" },
          required: false,
        }],
      };
      const actor = requestActor(a.manager);
      const change = await createEntitySchemaChange(d, actor, type.id, input);
      assertEquals(change.reservations, { cost: "prop_2" });
      assertEquals(await createEntitySchemaChange(d, actor, type.id, input), change);
      assertEquals(
        (await assertRejects(async () =>
          await createEntitySchemaChange(d, actor, type.id, {
            ...input,
            edits: [{
              op: "add_property",
              client_ref: "cost",
              field: { "x-order": 20, type: "string" },
              required: false,
            }],
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
        (await assertRejects(async () => await getEntitySchemaChange(d, b.manager, type.id, change.id), AppError)).code,
        "not_found",
      );
      assertEquals((await getEntitySchema(d, a.manager, { type_id: type.id })).schema_version, 1);
      const updated = await updateEntitySchemaChange(d, requestActor(a.manager), type.id, change.id, {
        ...input,
        expected_change_version: 1,
        edits: [{ ...input.edits[0], field: { ...input.edits[0].field, "x-show-in-list": true } }, {
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "商品名" },
          required: true,
        }],
      });
      const analyzeActor = requestActor(a.manager);
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
      assertEquals((await getEntitySchema(d, a.manager, { type_id: type.id })).schema_version, 1);
      await consume(worker);
      const ready = await getEntitySchemaChange(d, a.manager, type.id, change.id);
      assertEquals(ready.status, "ready");
      assertEquals(ready.analysis?.failed, 0);
      const applyInput = { expected_change_version: ready.version, analysis_id: ready.analysis!.id };
      const outcomes = await Promise.allSettled(
        [1, 2].map(() => applyEntitySchemaChange(d, requestActor(a.manager), type.id, change.id, applyInput)),
      );
      assertEquals(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      assertEquals((await getEntityType(d, a.manager, other.id)).schema_version, 1);
      const current = await getEntity(e, a.manager, entity.id);
      assertEquals(current.schema_version, 1);
      assertEquals(current.version, entity.version);
      assertEquals(current.title, "旧資料");
      assertEquals(
        (await getEntitySchema(d, a.manager, { type_id: type.id })).schema.properties.prop_1.title,
        "商品名",
      );
      assertEquals(
        (await assertRejects(async () =>
          await updateEntity(e, requestActor(a.manager), entity.id, {
            expected_version: entity.version,
            schema_version: 1,
            properties: { prop_1: "stale" },
          }), AppError)).code,
        "schema_changed",
      );
      const next = await createEntitySchemaChange(d, requestActor(a.manager), type.id, {
        expected_schema_version: 2,
        edits: [{ op: "add_property", client_ref: "next", field: { "x-order": 30, type: "string" }, required: false }],
      });
      assertEquals(next.reservations, { next: "prop_3" });
      const analyzed = await analyzeEntitySchemaChange(d, requestActor(a.manager), type.id, next.id, {
        expected_change_version: 1,
      });
      await consume(worker);
      await updateEntity(e, requestActor(a.manager), entity.id, {
        expected_version: entity.version,
        schema_version: 2,
        properties: { prop_2: 0 },
      });
      assertEquals((await getEntitySchemaChange(d, a.manager, type.id, next.id)).status, "stale");
      assertEquals(
        (await assertRejects(async () =>
          await applyEntitySchemaChange(d, requestActor(a.manager), type.id, next.id, {
            expected_change_version: 1,
            analysis_id: analyzed.analysis_id,
          }), AppError)).code,
        "schema_plan_stale",
      );
      const reservationRemoved = await updateEntitySchemaChange(d, requestActor(a.manager), type.id, next.id, {
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
      const reservedAfterDrop = await createEntitySchemaChange(d, requestActor(a.manager), type.id, {
        expected_schema_version: 2,
        edits: [{ op: "add_property", client_ref: "after", field: { "x-order": 40, type: "string" }, required: false }],
      });
      assertEquals(reservedAfterDrop.reservations, { after: "prop_4" });
      const narrowed = await createEntitySchemaChange(d, requestActor(a.manager), type.id, {
        expected_schema_version: 2,
        edits: [{
          op: "update_property",
          key: "prop_2",
          field: { "x-order": 20, type: "integer", minimum: 1 },
          required: false,
        }],
      });
      assertEquals(narrowed.change_kind, "migration_required");
      await analyzeEntitySchemaChange(d, requestActor(a.manager), type.id, narrowed.id, { expected_change_version: 1 });
      await consume(worker);
      const failures = await getEntitySchemaChange(d, a.manager, type.id, narrowed.id);
      assertEquals(failures.analysis?.failed, 1);
      assertEquals(failures.analysis?.errors[0].entity_id, entity.id);
      const settings = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
      await updateBusinessSettings(settings, requestActor(a.manager), {
        id: "record_templates",
        expected_version: 0,
        value: { entity_types: { [type.id]: { update: { memo: "$엔터티.이후.prop_2$", tag_ids: [] } } } },
      });
      for (const op of ["archive_property", "remove_property"]) {
        const error = await assertRejects(
          async () =>
            await createEntitySchemaChange(d, requestActor(a.manager), type.id, {
              expected_schema_version: 2,
              edits: [{ op, key: "prop_2" }],
            }),
          AppError,
        );
        assertEquals(error.code, "invalid_input");
        assertEquals(error.fields?.[0].path, `record_templates.entity_types.${type.id}.update.memo`);
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
    const owner = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await owner.createKind("競争対象");
      await owner.grantKind(owner.manager, type.id, "write");
      const other = await owner.createKind("独立対象");
      await owner.grantKind(owner.manager, other.id, "write");
      const drafts = await Promise.all(
        ["first", "second"].map((ref) =>
          createEntitySchemaChange(d, requestActor(owner.manager), type.id, {
            expected_schema_version: 1,
            edits: [{
              op: "add_property",
              client_ref: ref,
              field: { "x-order": 20, type: "string", title: ref },
              required: false,
            }],
          })
        ),
      );
      assertEquals(drafts.map((change) => Object.values(change.reservations)[0]).sort(), ["prop_2", "prop_3"]);
      const independent = await createEntitySchemaChange(d, requestActor(owner.manager), other.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "independent",
          field: { "x-order": 20, type: "string" },
          required: false,
        }],
      });
      assertEquals(independent.reservations, { independent: "prop_2" });
      const initial = await getEntitySchema(d, owner.manager, { type_id: type.id });
      const removed = await updateEntitySchemaChange(d, requestActor(owner.manager), type.id, drafts[0].id, {
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
      const after = await createEntitySchemaChange(d, requestActor(owner.manager), type.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "after-drop",
          field: { "x-order": 20, type: "string" },
          required: false,
        }],
      });
      assertEquals(after.reservations, { "after-drop": "prop_4" });
      const entity = await createEntity(e, requestActor(owner.manager), {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "original value" },
      });
      const publication = await createEntitySchemaChange(d, requestActor(owner.manager), type.id, {
        expected_schema_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: { ...initial.schema.properties.prop_1, title: "Published label" },
          required: true,
        }],
      });
      const accepted = await analyzeEntitySchemaChange(d, requestActor(owner.manager), type.id, publication.id, {
        expected_change_version: publication.version,
      });
      await consume(worker);
      assertEquals((await getEntitySchemaChange(d, owner.manager, type.id, publication.id)).status, "ready");
      const results = await Promise.allSettled([
        applyEntitySchemaChange(d, requestActor(owner.manager), type.id, publication.id, {
          expected_change_version: publication.version,
          analysis_id: accepted.analysis_id,
        }),
        updateEntity(e, requestActor(owner.manager), entity.id, {
          schema_version: 1,
          expected_version: entity.version,
          properties: { prop_1: "racing value" },
        }),
      ]);
      assertEquals(results.filter((result) => result.status === "fulfilled").length, 1);
      const current = await getEntity(e, owner.manager, entity.id),
        schema = await getEntitySchema(d, owner.manager, { type_id: type.id });
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

dbTest(
  "migration snapshot preview retains source, requires explicit failure fix and scopes sample ownership",
  async () => {
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = connect(workerUrl.href, { prepare: false, max: 1 }),
      admin = connect(urls.admin),
      sql = connect(urls.direct);
    const a = await businessWorkspaceFixture(admin, sql),
      b = await businessWorkspaceFixture(admin, sql),
      d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await a.createKind("Preview");
      await a.grantKind(a.manager, type.id, "write");
      const entity = await createEntity(e, requestActor(a.manager), {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "001" },
      });
      const input = {
        expected_schema_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: {
            "x-order": 10,
            "x-representative": true,
            "x-show-in-list": true,
            type: "string",
            minLength: 1,
            maxLength: 2,
          },
          required: true,
        }],
        migration: { rules: [], overrides: [] },
      };
      const plan = await createEntitySchemaChange(d, requestActor(a.manager), type.id, input);
      const accepted = await analyzeEntitySchemaChange(d, requestActor(a.manager), type.id, plan.id, {
        expected_change_version: plan.version,
      });
      await assertRejects(() =>
        getEntitySchemaAnalysisRows(d, a.manager, type.id, plan.id, { analysis_id: accepted.analysis_id })
      );
      await consume(worker);
      const ready = await getEntitySchemaChange(d, a.manager, type.id, plan.id);
      assertEquals(ready.analysis?.total, 1);
      assertEquals(ready.analysis?.failed, 1);
      assertEquals(ready.executable, false);
      const page = await getEntitySchemaAnalysisRows(d, a.manager, type.id, plan.id, {
        analysis_id: accepted.analysis_id,
        failures_only: true,
      });
      assertEquals(page.items[0].before, { prop_1: "001" });
      assertEquals(page.items[0].after, { prop_1: "001" });
      await assertRejects(() =>
        getEntitySchemaAnalysisRows(d, b.manager, type.id, plan.id, { analysis_id: accepted.analysis_id })
      );
      const fixed = await updateEntitySchemaChange(d, requestActor(a.manager), type.id, plan.id, {
        ...input,
        expected_change_version: plan.version,
        migration: { rules: [], overrides: [{ entity_id: entity.id, key: "prop_1", value: "01" }] },
      });
      assertEquals(fixed.version, 2);
      assertEquals(fixed.analysis, null);
      await analyzeEntitySchemaChange(d, requestActor(a.manager), type.id, plan.id, {
        expected_change_version: fixed.version,
      });
      await consume(worker);
      const result = await getEntitySchemaChange(d, a.manager, type.id, plan.id);
      assertEquals(result.executable, true);
      assertEquals(result.analysis?.changed, 1);
      assertEquals(result.analysis?.replacements, 1);
      assertEquals((await getEntity(e, a.manager, entity.id)).properties, { prop_1: "001" });
      assertEquals((await getEntitySchema(d, a.manager, { type_id: type.id })).schema_version, 1);
    } finally {
      await a.cleanup();
      await b.cleanup();
      await Promise.all([worker.end(), sql.end(), admin.end()]);
    }
  },
);

dbTest(
  "persisted migration worker converts optional text with missing-only fill, null failures and deleted snapshots",
  async () => {
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
    const worker = connect(workerUrl.href, { prepare: false, max: 1 }),
      admin = connect(urls.admin),
      sql = connect(urls.direct);
    const a = await fixtureOwner(admin),
      d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(d, requestActor(a.actor), { label: "Persisted conversion" });
      const add = await createEntitySchemaChange(d, requestActor(a.actor), type.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "quantity",
          field: { "x-order": 20, type: ["string", "null"] },
          required: false,
        }],
      });
      assertEquals(add.reservations, { quantity: "prop_2" });
      const accepted = await analyzeEntitySchemaChange(d, requestActor(a.actor), type.id, add.id, {
        expected_change_version: 1,
      });
      await consume(worker);
      await applyEntitySchemaChange(d, requestActor(a.actor), type.id, add.id, {
        expected_change_version: 1,
        analysis_id: accepted.analysis_id,
      });
      const valid = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "valid", prop_2: "12" },
      });
      const missing = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "missing" },
      });
      const leading = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "identifier", prop_2: "001" },
      });
      const nullable = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "null", prop_2: null },
      });
      const deleted = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "deleted", prop_2: "7" },
      });
      await deleteEntity(e, requestActor(a.actor), deleted.id, deleted.version);
      const before = await Promise.all(
        [valid, missing, leading, nullable, deleted].map((row) => getEntity(e, a.actor, row.id)),
      );
      const input = {
        expected_schema_version: 2,
        edits: [{ op: "update_property", key: "prop_2", field: { "x-order": 20, type: "integer" }, required: true }],
        migration: {
          rules: [{ op: "convert", key: "prop_2", to: "integer" }, {
            op: "fill",
            key: "prop_2",
            value: 0,
            include_null: false,
          }],
          overrides: [],
        },
      };
      const plan = await createEntitySchemaChange(d, requestActor(a.actor), type.id, input);
      assertEquals(plan.change_kind, "migration_required");
      assertEquals<unknown>(plan.migration.rules, input.migration.rules);
      const first = await analyzeEntitySchemaChange(d, requestActor(a.actor), type.id, plan.id, {
        expected_change_version: 1,
      });
      await consume(worker);
      const failed = await getEntitySchemaChange(d, a.actor, type.id, plan.id);
      assertEquals([
        failed.analysis?.total,
        failed.analysis?.processed,
        failed.analysis?.failed,
        failed.analysis?.changed,
        failed.analysis?.unchanged,
        failed.analysis?.removed,
        failed.analysis?.replacements,
      ], [5, 5, 2, 3, 2, 0, 1]);
      assertEquals(failed.executable, false);
      const page = await getEntitySchemaAnalysisRows(d, a.actor, type.id, plan.id, { analysis_id: first.analysis_id });
      assertEquals(page.items.length, 5);
      const rows = new Map(page.items.map((row) => [row.entity_id, row]));
      assertEquals(rows.get(valid.id)?.after, { prop_1: "valid", prop_2: 12 });
      assertEquals(rows.get(missing.id)?.before, { prop_1: "missing" });
      assertEquals(rows.get(missing.id)?.after, { prop_1: "missing", prop_2: 0 });
      assertEquals(rows.get(leading.id)?.after, { prop_1: "identifier", prop_2: "001" });
      assertEquals(rows.get(leading.id)!.errors.length > 0, true);
      assertEquals(rows.get(nullable.id)?.after, { prop_1: "null", prop_2: null });
      assertEquals(rows.get(nullable.id)!.errors.length > 0, true);
      assertEquals(rows.get(deleted.id)?.after, { prop_1: "deleted", prop_2: 7 });
      assertEquals(rows.get(deleted.id)?.errors, []);
      const fixed = await updateEntitySchemaChange(d, requestActor(a.actor), type.id, plan.id, {
        ...input,
        expected_change_version: 1,
        migration: {
          ...input.migration,
          overrides: [{ entity_id: leading.id, key: "prop_2", value: 1 }, {
            entity_id: nullable.id,
            key: "prop_2",
            value: 0,
          }],
        },
      });
      assertEquals(fixed.version, 2);
      assertEquals(fixed.analysis, null);
      await assertRejects(
        () => getEntitySchemaAnalysisRows(d, a.actor, type.id, plan.id, { analysis_id: first.analysis_id }),
        AppError,
      );
      const second = await analyzeEntitySchemaChange(d, requestActor(a.actor), type.id, plan.id, {
        expected_change_version: 2,
      });
      assertEquals(second.analysis_id === first.analysis_id, false);
      await consume(worker);
      const ready = await getEntitySchemaChange(d, a.actor, type.id, plan.id);
      assertEquals([
        ready.analysis?.total,
        ready.analysis?.processed,
        ready.analysis?.failed,
        ready.analysis?.changed,
        ready.analysis?.unchanged,
        ready.analysis?.replacements,
      ], [5, 5, 0, 5, 0, 3]);
      assertEquals(ready.executable, true);
      const fixedPage = await getEntitySchemaAnalysisRows(d, a.actor, type.id, plan.id, {
        analysis_id: second.analysis_id,
      });
      assertEquals(fixedPage.items.find((row) => row.entity_id === leading.id)?.after, {
        prop_1: "identifier",
        prop_2: 1,
      });
      assertEquals(fixedPage.items.find((row) => row.entity_id === nullable.id)?.after, { prop_1: "null", prop_2: 0 });
      for (const source of before) {
        const current = await getEntity(e, a.actor, source.id);
        assertEquals([current.properties, current.version, current.schema_version, current.deleted_at], [
          source.properties,
          source.version,
          source.schema_version,
          source.deleted_at,
        ]);
      }
      assertEquals(before.find((row) => row.id === deleted.id)?.deleted_at !== null, true);
      assertEquals((await getEntitySchema(d, a.actor, { type_id: type.id })).schema_version, 2);
    } finally {
      await a.cleanup();
      await Promise.all([worker.end(), sql.end(), admin.end()]);
    }
  },
);

dbTest("schema discard preserves data, rejects stale/applied/foreign requests and fences late analysis", async () => {
  const { discardEntitySchemaChange } = await import("../../functions/_shared/core/entity-types/schema-changes.ts");
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
  const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
  const wu = new URL(urls.admin);
  wu.username = "app_worker";
  wu.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
  const worker = connect(wu.href, { max: 1 });
  try {
    const t = await createEntityType(d, requestActor(a.actor), { label: "폐기 검사" });
    const entity = await createEntity(e, requestActor(a.actor), {
      entity_type_id: t.id,
      schema_version: 1,
      source: "app",
      external_id: crypto.randomUUID(),
      properties: { prop_1: "원본 유지" },
    });
    const change = await createEntitySchemaChange(d, requestActor(a.actor), t.id, {
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: {
          "x-order": 10,
          "x-representative": true,
          "x-show-in-list": true,
          type: "string",
          title: "새 이름",
          minLength: 1,
          maxLength: 4096,
        },
        required: true,
      }],
    });
    await assertRejects(
      () => discardEntitySchemaChange(d, requestActor(b.actor), t.id, change.id, { expected_change_version: 1 }),
      AppError,
    );
    await assertRejects(
      () => discardEntitySchemaChange(d, requestActor(a.actor), t.id, change.id, { expected_change_version: 2 }),
      AppError,
      "버전",
    );
    await analyzeEntitySchemaChange(d, requestActor(a.actor), t.id, change.id, { expected_change_version: 1 });
    const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
    const actor = requestActor(a.actor);
    const discarded = await discardEntitySchemaChange(d, actor, t.id, change.id, { expected_change_version: 1 });
    assertEquals(discarded.status, "cancelled");
    assertEquals(discarded.version, 2);
    assertEquals(
      (await discardEntitySchemaChange(d, actor, t.id, change.id, { expected_change_version: 1 })).version,
      2,
    );
    assertEquals(
      (await discardEntitySchemaChange(d, requestActor(a.actor), t.id, change.id, { expected_change_version: 1 }))
        .status,
      "cancelled",
    );
    const batch = claimed.batch;
    const results = batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
      compileMigration(batch.target, batch.migration)(r.entity_id, r.properties)
    );
    const [late] = await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
      worker.json(results)
    }) as accepted`;
    assertEquals(late.accepted, false);
    assertEquals((await getEntitySchemaChange(d, a.actor, t.id, change.id)).status, "cancelled");
    assertEquals((await getEntity(e, a.actor, entity.id)).properties, { prop_1: "원본 유지" });
    assertEquals((await getEntityType(d, a.actor, t.id)).schema_version, 1);
    await assertRejects(
      () =>
        applyEntitySchemaChange(d, requestActor(a.actor), t.id, change.id, {
          expected_change_version: 2,
          analysis_id: batch.id,
        }),
      AppError,
    );
    const publishable = await createEntitySchemaChange(d, requestActor(a.actor), t.id, {
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: {
          "x-order": 10,
          "x-representative": true,
          "x-show-in-list": true,
          type: "string",
          title: "적용 이름",
          minLength: 1,
          maxLength: 4096,
        },
        required: true,
      }],
    });
    await analyzeEntitySchemaChange(d, requestActor(a.actor), t.id, publishable.id, { expected_change_version: 1 });
    await consume(worker);
    const reviewed = await getEntitySchemaChange(d, a.actor, t.id, publishable.id);
    await applyEntitySchemaChange(d, requestActor(a.actor), t.id, reviewed.id, {
      expected_change_version: 1,
      analysis_id: reviewed.analysis!.id,
    });
    await assertRejects(
      () => discardEntitySchemaChange(d, requestActor(a.actor), t.id, reviewed.id, { expected_change_version: 1 }),
      AppError,
      "이미 적용",
    );
    const migrating = await createEntitySchemaChange(d, requestActor(a.actor), t.id, {
      expected_schema_version: 2,
      edits: [{
        op: "add_property",
        client_ref: "confirmed",
        field: { "x-order": 20, type: "boolean", title: "확인" },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_2", value: false }], overrides: [] },
    });
    await analyzeEntitySchemaChange(d, requestActor(a.actor), t.id, migrating.id, { expected_change_version: 1 });
    await consume(worker);
    const prepared = await getEntitySchemaChange(d, a.actor, t.id, migrating.id);
    const { startEntitySchemaMigration, cancelEntitySchemaMigration } = await import(
      "../../functions/_shared/core/entity-types/schema-migrations.ts"
    );
    const job = await startEntitySchemaMigration(d, requestActor(a.actor), t.id, prepared.id, {
      expected_change_version: 1,
      expected_schema_version: 2,
      analysis_id: prepared.analysis!.id,
      fingerprint: prepared.fingerprint,
    });
    await assertRejects(
      () => discardEntitySchemaChange(d, requestActor(a.actor), t.id, prepared.id, { expected_change_version: 1 }),
      AppError,
      "진행 중인",
    );
    await cancelEntitySchemaMigration(d, requestActor(a.actor), job.job_id, { expected_job_version: job.job_version });
    assertEquals(
      (await discardEntitySchemaChange(d, requestActor(a.actor), t.id, prepared.id, { expected_change_version: 1 }))
        .status,
      "cancelled",
    );
  } finally {
    await a.cleanup();
    await b.cleanup();
    await worker.end();
    await sql.end();
    await admin.end();
  }
});

dbTest(
  "empty material publishes structural changes immediately and rejects an intervening entity insertion",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 1 });
    const owner = await businessWorkspaceFixture(admin, sql);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) }, e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await owner.createKind("빈 자료 변경");
      await owner.grantKind(owner.manager, type.id, "write");
      const create = (version: number, title: string) =>
        createEntitySchemaChange(d, requestActor(owner.manager), type.id, {
          expected_schema_version: version,
          edits: [{
            op: "add_property",
            client_ref: title,
            field: { "x-order": version * 10 + 10, type: "integer", title },
            required: true,
          }],
        });
      const first = await create(1, "필수 수량");
      assertEquals(first.change_kind, "migration_required");
      const accepted = await analyzeEntitySchemaChange(d, requestActor(owner.manager), type.id, first.id, {
        expected_change_version: first.version,
      });
      const ready = await getEntitySchemaChange(d, owner.manager, type.id, first.id);
      assertEquals([ready.status, ready.analysis?.status, ready.analysis?.total], ["ready", "succeeded", 0]);
      assertEquals(ready.analysis?.id, accepted.analysis_id);
      const applied = await applyEntitySchemaChange(d, requestActor(owner.manager), type.id, first.id, {
        expected_change_version: first.version,
        analysis_id: accepted.analysis_id,
      });
      assertEquals(applied.status, "applied");
      assertEquals((await getEntitySchema(d, owner.manager, { type_id: type.id })).schema.required, [
        "prop_1",
        "prop_2",
      ]);
      const second = await create(2, "추가 수량");
      const stale = await analyzeEntitySchemaChange(d, requestActor(owner.manager), type.id, second.id, {
        expected_change_version: second.version,
      });
      await createEntity(e, requestActor(owner.manager), {
        entity_type_id: type.id,
        schema_version: 2,
        source: "app",
        external_id: crypto.randomUUID(),
        properties: { prop_1: "늦게 등록", prop_2: 0 },
      });
      const error = await assertRejects(() =>
        applyEntitySchemaChange(d, requestActor(owner.manager), type.id, second.id, {
          expected_change_version: second.version,
          analysis_id: stale.analysis_id,
        })
      );
      assertEquals((error as AppError).code, "schema_plan_stale");
      assertEquals((await getEntitySchema(d, owner.manager, { type_id: type.id })).schema_version, 2);
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "first schema review persists new field order, labels, representative and conversion references together",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 1 });
    const owner = await businessWorkspaceFixture(admin, sql), d = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const type = await owner.createKind("한번에 항목 설정");
      await owner.grantKind(owner.manager, type.id, "write");
      const draft = await createEntitySchemaChange(d, requestActor(owner.manager), type.id, {
        expected_schema_version: 1,
        edits: [
          {
            op: "add_property",
            client_ref: "choice",
            field: {
              "x-order": 20,
              "x-list-order": 10,
              "x-show-in-list": true,
              type: ["string", "null"],
              title: "상태",
              oneOf: [{ const: "ready", title: "판매 중" }, { const: null }],
            },
          },
          {
            op: "add_property",
            client_ref: "name",
            field: {
              "x-order": 10,
              "x-list-order": 20,
              "x-representative": true,
              "x-show-in-list": true,
              type: "string",
              title: "상품명",
              minLength: 1,
            },
            required: true,
          },
          {
            op: "update_property",
            key: "prop_1",
            field: { type: "string", title: "이름", minLength: 1, maxLength: 4096, "x-order": 30 },
            required: true,
          },
        ],
        migration: { rules: [{ op: "fill", key: "new_name", value: "새 상품" }] },
      });
      assertEquals(draft.target.schema.properties.prop_3["x-representative"], true);
      assertEquals(draft.target.schema.properties.prop_2.oneOf, [{ const: "ready", title: "판매 중" }, {
        const: null,
      }]);
      assertEquals(
        Object.entries(draft.target.schema.properties).sort((a, b) => a[1]["x-order"] - b[1]["x-order"]).map(([key]) =>
          key
        ),
        ["prop_3", "prop_2", "prop_1"],
      );
      assertEquals(draft.migration.rules, [{ op: "fill", key: "prop_3", value: "새 상품", include_null: false }]);
      const analysis = await analyzeEntitySchemaChange(d, requestActor(owner.manager), type.id, draft.id, {
        expected_change_version: draft.version,
      });
      await applyEntitySchemaChange(d, requestActor(owner.manager), type.id, draft.id, {
        expected_change_version: draft.version,
        analysis_id: analysis.analysis_id,
      });
      const published = await getEntitySchema(d, owner.manager, { type_id: type.id });
      assertEquals(published.schema.properties, draft.target.schema.properties);
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
