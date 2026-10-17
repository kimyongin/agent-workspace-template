import { assertEquals } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import {
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
const admin = connect(urls.admin), sql = connect(urls.direct);
const deps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) };
dbTest("whole model analysis without conversion needs remains a private ready review", async () => {
  const fixture = await fixtureOwner(admin);
  try {
    const document = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    const input = { mode: "copy", document: JSON.stringify(document) };
    const review = await previewDataModel(deps, fixture.actor, input);
    const change = await prepareDataModel(deps, requestActor(fixture.actor), {
      ...input,
      preview_fingerprint: review.fingerprint,
    });
    assertEquals(change.status, "ready");
    assertEquals((await exportDataModel(deps, fixture.actor)).entity_types.length, 0);
    const analyzed = await analyzeDataModel(deps, requestActor(fixture.actor), change.id, {
      expected_version: change.version,
    });
    assertEquals(analyzed.status, "ready");
    assertEquals(analyzed.group?.children.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

import { assertRejects } from "@std/assert";
import { applyDataModel, getDataModelChange } from "../../functions/_shared/core/data-model/application.ts";
import { createEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { startEntitySchemaMigration } from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.toString());
dbTest(
  "two-kind durable model conversion prepares privately and publishes values, compatible settings and relationship once",
  async () => {
    const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      for (const kind of sample.entity_types.slice(0, 2)) {
        kind.schema.properties.prop_2 = { type: "string", "x-order": 10 };
      }
      const input = { mode: "copy", document: JSON.stringify(sample) },
        preview = await previewDataModel(deps, fixture.actor, input);
      const initial = await prepareDataModel(deps, requestActor(fixture.actor), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      assertEquals(
        (await applyDataModel(deps, requestActor(fixture.actor), initial.id, { expected_version: initial.version }))
          .status,
        "applied",
      );
      const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
      const ids = sample.entity_types.slice(0, 2).map((t) => preview.mapping.types[t.ref]);
      const entities = [];
      for (const [index, id] of ids.entries()) {
        entities.push(
          await createEntity(entityDeps, requestActor(fixture.actor), {
            entity_type_id: id,
            schema_version: 1,
            properties: { prop_1: `자료${index}`, prop_2: String(12 + index) },
          }),
        );
      }
      const before = await exportDataModel(deps, fixture.actor), target = structuredClone(before);
      for (const kind of target.entity_types) {
        if (ids.includes(kind.schema["x-type-id"])) {
          kind.schema.properties.prop_2 = { type: "integer", "x-order": 10 };
        } else kind.schema.description = "함께 게시하는 호환 설정";
      }
      target.relations[0].ends[0].label = "함께 바꾼 관계";
      const source = { mode: "update", document: JSON.stringify(target) },
        review = await previewDataModel(deps, fixture.actor, source);
      const saved = await prepareDataModel(deps, requestActor(fixture.actor), {
        ...source,
        preview_fingerprint: review.fingerprint,
      });
      assertEquals(saved.status, "needs_conversion");
      const conversions = target.entity_types.filter((t) => ids.includes(t.schema["x-type-id"])).map((t) => ({
        type_ref: t.ref,
        migration: { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] },
      }));
      const analyzed = await analyzeDataModel(deps, requestActor(fixture.actor), saved.id, {
        expected_version: saved.version,
        conversions,
      });
      assertEquals(analyzed.status, "analyzing");
      const read = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(read.group?.children.length, 2);
      await assertRejects(() => getDataModelChange(deps, foreign.actor, saved.id));
      const child = read.group!.children[0];
      await assertRejects(
        () =>
          startEntitySchemaMigration(
            { uow: new SqlEntityTypeUnitOfWork(sql) },
            requestActor(fixture.actor),
            child.change.type_id,
            child.change.id,
            { expected_change_version: child.change.version, analysis_id: child.change.analysis!.id },
          ),
        Error,
        "전체 모델",
      );
      for (let step = 0; step < 10; step++) {
        const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!claimed.batch) break;
        const batch = claimed.batch, convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
        const result = batch.rows.map((
          r: { entity_id: string; properties: Record<string, unknown>; recovery_properties?: Record<string, unknown> },
        ) => convert(r.entity_id, r.properties, r.recovery_properties));
        const [completed] = await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
          worker.json(result)
        }) as accepted`;
        assertEquals(completed.accepted, true);
      }
      const ready = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(ready.status, "ready");
      const actor = requestActor(fixture.actor), action = { expected_version: ready.version };
      const accepted = await applyDataModel(deps, actor, saved.id, action);
      assertEquals(accepted.status, "queued");
      assertEquals(await applyDataModel(deps, actor, saved.id, action), accepted);
      const queued = await getDataModelChange(deps, fixture.actor, saved.id);
      const isolated = queued.group!.children[0].job!;
      const [standalone] = await worker`select app.claim_entity_schema_migration() as batch`;
      assertEquals(standalone.batch, null);
      const [denied] =
        await worker`select app.commit_entity_schema_migration(${isolated.id},0,'irrelevant',${SEARCH_PIPELINE}) as committed`;
      assertEquals(denied.committed, false);
      await assertRejects(() => worker`select id from app.data_model_changes limit 1`);
      assertEquals(await exportDataModel(deps, fixture.actor), before);
      for (const entity of entities) {
        assertEquals((await getEntity(entityDeps, fixture.actor, entity.id)).properties, entity.properties);
      }
      for (let step = 0; step < 20; step++) {
        const [claimed] = await worker`select app.claim_data_model_conversion() as batch`;
        if (!claimed.batch) break;
        const parent = claimed.batch;
        if (parent.status === "committing") {
          const [result] =
            await worker`select app.commit_data_model_conversion(${parent.id},${parent.fence},${SEARCH_PIPELINE}) as committed`;
          assertEquals(result.committed, true);
        } else {
          const prepared = await prepareMigrationBatch(parent.child, new Date());
          assertEquals(prepared.stale, false);
          const [stale] = await worker`select app.stage_data_model_conversion(${parent.id},${
            Number(parent.fence) + 1
          },${parent.child.id},${parent.child.fence},${worker.json(prepared.results)}) as accepted`;
          assertEquals(stale.accepted, false);
          const [result] =
            await worker`select app.stage_data_model_conversion(${parent.id},${parent.fence},${parent.child.id},${parent.child.fence},${
              worker.json(prepared.results)
            }) as accepted`;
          assertEquals(result.accepted, true);
          assertEquals(await exportDataModel(deps, fixture.actor), before);
        }
      }
      const done = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(done.status, "applied");
      assertEquals(done.result?.counts?.types.updated, 3);
      for (const [index, entity] of entities.entries()) {
        assertEquals((await getEntity(entityDeps, fixture.actor, entity.id)).properties.prop_2, 12 + index);
      }
      const after = await exportDataModel(deps, fixture.actor);
      assertEquals(after.relations[0].ends[0].label, "함께 바꾼 관계");
      for (const child of done.group!.children) {
        assertEquals(child.job?.status, "succeeded");
        assertEquals(child.job?.recovery?.status, "available");
      }
    } finally {
      await fixture.cleanup();
      await foreign.cleanup();
    }
  },
);
