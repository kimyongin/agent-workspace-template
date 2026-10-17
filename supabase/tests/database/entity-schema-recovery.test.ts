import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { changeConfiguredRelation, configuredRelationFixture, listConfiguredLinks } from "./_configured-relations.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import {
  createEntityType,
  getEntitySchema,
  getEntityType,
  updateEntityType,
} from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import {
  createRecord,
  createTask,
  updateRecord,
  updateTask,
} from "../../functions/_shared/core/activity/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaAnalysisRows,
  getEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import {
  createEntitySchemaRecovery,
  getEntitySchemaMigration,
  listEntitySchemaMigrations,
  startEntitySchemaMigration,
} from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { jsonbText } from "../../functions/_shared/core/entity-types/schema-rules.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { createTag } from "../../functions/_shared/core/tags/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { SchemaEdit } from "../../functions/_shared/contracts/entity-schema-change.ts";
async function fixture() {
  const admin = connect(urls.admin),
    sql = connect(urls.direct, { max: 6 }),
    a = await fixtureOwner(admin),
    b = await fixtureOwner(admin);
  const url = new URL(urls.admin);
  url.username = "app_worker";
  url.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
  const worker = connect(url.href, {
    max: 1,
    prepare: false,
    connection: { statement_timeout: 15000, lock_timeout: 5000 },
  });
  const d = { uow: new SqlEntityTypeUnitOfWork(sql) },
    e = { uow: new SqlEntityUnitOfWork(sql) },
    p = configuredRelationFixture(sql),
    activity = {
      uow: new SqlUnitOfWork(sql),
      clock: { now: () => new Date("2026-10-12T00:00:00Z") },
    };
  const actor = () => requestActor(a.actor);
  async function analyze(type: string, id: string, version: number) {
    await analyzeEntitySchemaChange(d, actor(), type, id, {
      expected_change_version: version,
    });
    for (let n = 0; n < 100; n++) {
      const [r] = await worker`select app.claim_entity_schema_analysis() as batch`;
      if (!r.batch) break;
      const batch = r.batch,
        transform = compileMigration(
          batch.target,
          batch.migration,
          batch.recovery_keys,
        );
      assert(batch.rows.length <= 50);
      assert(
        new TextEncoder().encode(jsonbText(batch.rows)).byteLength <= 524288,
        "analysis claim must bound current and owned recovery properties together",
      );
      const [completed] = await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        worker.json(
          batch.rows.map((
            row: {
              entity_id: string;
              properties: Record<string, unknown>;
              recovery_properties: Record<string, unknown>;
            },
          ) => transform(row.entity_id, row.properties, row.recovery_properties)),
        )
      }) as completed`;
      assert(completed.completed);
      if (batch.rows.length === 0) {
        const change = await getEntitySchemaChange(d, a.actor, type, id);
        assert(
          change.analysis?.status === "succeeded" ||
            change.analysis?.status === "failed",
          "an empty zero-target analysis must finalize rather than stall",
        );
      }
    }
    return getEntitySchemaChange(d, a.actor, type, id);
  }
  async function accept(type: string, id: string, version: number) {
    const ready = await analyze(type, id, version);
    assert(ready.executable);
    return startEntitySchemaMigration(d, actor(), type, id, {
      expected_change_version: ready.version,
      expected_schema_version: ready.source_schema_version,
      analysis_id: ready.analysis!.id,
      fingerprint: ready.fingerprint,
    });
  }
  async function finish(id: string) {
    for (let n = 0; n < 100; n++) {
      const [r] = await worker`select app.claim_entity_schema_migration() as batch`;
      assert(r.batch);
      const batch = r.batch;
      assertEquals(batch.id, id);
      assert(batch.rows.length <= 50);
      assert(
        new TextEncoder().encode(jsonbText(batch.rows)).byteLength <= 524288,
        "migration claim must bound source, after and owned recovery properties together",
      );
      if (batch.status === "committing") {
        const [done] =
          await worker`select app.commit_entity_schema_migration(${id},${batch.fence},${batch.source_template_fingerprint},${SEARCH_PIPELINE}) as done`;
        assert(done.done);
        return;
      }
      const prep = await prepareMigrationBatch(batch, new Date("2026-10-12T00:00:00Z"));
      assert(!prep.stale);
      assert(batch.rows.length === 0 || prep.results.length > 0);
      assert(
        new TextEncoder().encode(jsonbText(prep.results)).byteLength <= 1048576,
      );
      const before = await getEntitySchemaMigration(d, a.actor, id);
      const [staged] = await worker`select app.stage_entity_schema_migration(${id},${batch.fence},${
        worker.json(prep.results)
      }) as staged`;
      assert(staged.staged);
      const after = await getEntitySchemaMigration(d, a.actor, id);
      assert(
        after.processed > before.processed ||
          after.status === "ready_to_commit" || after.status === "failed",
        "staging must advance processed rows or finalize even for a zero-target job",
      );
    }
    throw Error("budget");
  }
  async function original(label = "Recovery") {
    const type = await createEntityType(d, actor(), { label });
    const fields = [
      { type: ["string", "null"] },
      { type: "integer" },
      { type: "boolean" },
      { type: "string" },
      {
        type: "string",
      },
    ];
    const change = await createEntitySchemaChange(d, actor(), type.id, {
      expected_schema_version: 1,
      edits: fields.map((field, i) => ({
        op: "add_property",
        client_ref: String(i),
        field: { ...field, "x-order": (i + 2) * 10 },
        required: false,
      })),
    });
    const ready = await analyze(type.id, change.id, change.version);
    await applyEntitySchemaChange(d, actor(), type.id, change.id, {
      expected_change_version: 1,
      analysis_id: ready.analysis!.id,
    });
    const x = await createEntity(e, actor(), {
      entity_type_id: type.id,
      schema_version: 2,
      properties: {
        prop_1: "original",
        prop_2: null,
        prop_3: 0,
        prop_4: false,
        prop_5: "",
      },
    });
    const deleted = await createEntity(e, actor(), {
      entity_type_id: type.id,
      schema_version: 2,
      properties: { prop_1: "deleted" },
    });
    await deleteEntity(e, actor(), deleted.id, deleted.version);
    const other = await createEntityType(d, actor(), { label: `${label} Peer` }),
      peer = await createEntity(e, actor(), {
        entity_type_id: other.id,
        schema_version: 1,
        properties: { prop_1: "peer" },
      });
    await changeConfiguredRelation(p, actor(), x.id, {
      other_id: peer.id,
      expected_version: x.version,
      expected_other_version: peer.version,
    }, true);
    const same = await createEntity(e, actor(), {
      entity_type_id: type.id,
      schema_version: 2,
      properties: { prop_1: "same" },
    });
    const current = await getEntity(e, a.actor, x.id);
    await changeConfiguredRelation(p, actor(), x.id, {
      other_id: same.id,
      expected_version: current.version,
      expected_other_version: same.version,
    }, true);
    const task = await createTask(activity, actor(), {
      kind: "once",
      title: "Selection",
      body: "old body",
      entity_ids: [x.id],
      tag_ids: [],
    });
    const record = await createRecord(activity, actor(), {
      body: "historical body",
      entity_ids: [x.id],
      tag_ids: [],
    });
    const source = await getEntitySchema(d, a.actor, { type_id: type.id });
    const edits: SchemaEdit[] = [2, 3, 4, 5, 6].map((i) => ({
      op: "remove_property",
      key: `prop_${i}`,
    }));
    const migration = await createEntitySchemaChange(d, actor(), type.id, {
      expected_schema_version: 2,
      edits,
      migration: {
        rules: [2, 3, 4, 5, 6].map((i) => ({ op: "remove", key: `prop_${i}` })),
        overrides: [],
      },
    });
    const job = await accept(type.id, migration.id, migration.version);
    await finish(job.job_id);
    return { type, source, x, deleted, other, peer, same, task, record, job };
  }
  async function recovery(id: string, key = actor()) {
    const job = await getEntitySchemaMigration(d, a.actor, id),
      t = await getEntityType(d, a.actor, job.type_id);
    return createEntitySchemaRecovery(d, key, id, {
      expected_job_version: job.version,
      expected_schema_version: t.schema_version,
    });
  }
  async function largeOriginal(count: number) {
    const type = await createEntityType(d, actor(), {
      label: "Large recovery",
    });
    const addition = await createEntitySchemaChange(d, actor(), type.id, {
      expected_schema_version: 1,
      edits: Array.from(
        { length: 5 },
        (_, i) => ({
          op: "add_property" as const,
          client_ref: String(i),
          field: { "x-order": (i + 2) * 10, type: "string" as const },
          required: false,
        }),
      ),
    });
    const ready = await analyze(type.id, addition.id, addition.version);
    await applyEntitySchemaChange(d, actor(), type.id, addition.id, {
      expected_change_version: addition.version,
      analysis_id: ready.analysis!.id,
    });
    // Fixture owner only: valid multibyte properties, no shared account or service mutations.
    await asUser(
      sql,
      a.actor.userId,
      (tx) =>
        tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) select ${a.actor.userId},'app:'||${type.id}::text||':'||n,'app',n::text,${type.id},2,jsonb_build_object('prop_1','row '||n,'prop_2',repeat('한',4096),'prop_3',repeat('글',4096),'prop_4',repeat('값',4096),'prop_5',repeat('복',4096),'prop_6',repeat('구',4096)) from generate_series(1,${count}) n`,
    );
    await updateBusinessSettings(
      { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: activity.clock },
      actor(),
      {
        id: "record_templates",
        expected_version: 0,
        value: {
          entity_types: {
            [type.id]: { update: { memo: "값 변경", tag_ids: [] } },
          },
        },
      },
    );
    const removal = await createEntitySchemaChange(d, actor(), type.id, {
      expected_schema_version: 2,
      edits: [2, 3, 4, 5, 6].map((i) => ({
        op: "remove_property" as const,
        key: `prop_${i}`,
      })),
      migration: {
        rules: [2, 3, 4, 5, 6].map((i) => ({
          op: "remove" as const,
          key: `prop_${i}`,
        })),
        overrides: [],
      },
    });
    const job = await accept(type.id, removal.id, removal.version);
    await finish(job.job_id);
    return { type, job };
  }
  return {
    admin,
    sql,
    a,
    b,
    worker,
    d,
    e,
    p,
    activity,
    actor,
    analyze,
    accept,
    finish,
    original,
    largeOriginal,
    recovery,
    cleanup: async () => {
      await a.cleanup();
      await b.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    },
  };
}
const code = async (fn: () => Promise<unknown>, c: string) => {
  const e = await assertRejects(fn, AppError);
  assertEquals(e.code, c);
  return e;
};
dbTest(
  "recovery forward draft exact literals, owner scope, idempotency, mappings, current label and historical bodies",
  async () => {
    const f = await fixture();
    try {
      const o = await f.original(),
        t = await getEntityType(f.d, f.a.actor, o.type.id);
      await updateEntityType(f.d, f.actor(), t.id, {
        expected_schema_version: t.schema_version,
        label: "Renamed",
        icon_id: "leaf",
      });
      await updateTask(f.activity, f.actor(), o.task.id, {
        expected_version: o.task.version,
        body: "edited note",
      });
      await updateRecord(f.activity, f.actor(), o.record.id, {
        expected_version: o.record.version,
        body: "edited body",
      });
      const peer = await getEntity(f.e, f.a.actor, o.peer.id);
      await updateEntity(f.e, f.actor(), peer.id, {
        expected_version: peer.version,
        schema_version: 1,
        properties: { prop_1: "unrelated peer edit" },
      });
      const peerType = await getEntityType(f.d, f.a.actor, o.other.id);
      const peerSchemaChange = await createEntitySchemaChange(
        f.d,
        f.actor(),
        o.other.id,
        {
          expected_schema_version: peerType.schema_version,
          edits: [{
            op: "add_property",
            client_ref: "unrelated",
            field: { "x-order": 20, type: "string" },
            required: false,
          }],
        },
      );
      const peerAnalysis = await f.analyze(
        o.other.id,
        peerSchemaChange.id,
        peerSchemaChange.version,
      );
      await applyEntitySchemaChange(
        f.d,
        f.actor(),
        o.other.id,
        peerSchemaChange.id,
        {
          expected_change_version: peerSchemaChange.version,
          analysis_id: peerAnalysis.analysis!.id,
        },
      );
      const history = await asUser(
        f.sql,
        f.a.actor.userId,
        (tx) => tx`select id,body,entity_context from app.records order by id`,
      );
      const key = f.actor(), c = await f.recovery(o.job.job_id, key);
      assertEquals(c.status, "draft");
      assertEquals(c.change_kind, "migration_required");
      assertEquals(await f.recovery(o.job.job_id, key), c);
      assertEquals((await getEntity(f.e, f.a.actor, o.x.id)).properties, {
        prop_1: "original",
      });
      const job = await getEntitySchemaMigration(f.d, f.a.actor, o.job.job_id),
        current = await getEntityType(f.d, f.a.actor, o.type.id);
      assertEquals(job.recovery?.status, "available");
      assertEquals(job.type.label, "Renamed");
      await code(
        () =>
          createEntitySchemaRecovery(f.d, requestActor(f.b.actor), job.id, {
            expected_job_version: job.version,
            expected_schema_version: current.schema_version,
          }),
        "not_found",
      );
      await code(() =>
        createEntitySchemaRecovery(f.d, key, job.id, {
          expected_job_version: job.version,
          expected_schema_version: current.schema_version + 1,
        }), "idempotency_key_reused");
      const ready = await f.analyze(o.type.id, c.id, c.version),
        rows = await getEntitySchemaAnalysisRows(
          f.d,
          f.a.actor,
          o.type.id,
          c.id,
          {
            analysis_id: ready.analysis!.id,
            limit: 100,
          },
        );
      assertEquals(
        rows.items.find((r) => r.entity_id === o.x.id)?.after,
        {
          prop_1: "original",
          prop_2: null,
          prop_3: 0,
          prop_4: false,
          prop_5: "",
        },
      );
      const accepted = await startEntitySchemaMigration(
        f.d,
        f.actor(),
        o.type.id,
        c.id,
        {
          expected_change_version: c.version,
          expected_schema_version: current.schema_version,
          analysis_id: ready.analysis!.id,
          fingerprint: ready.fingerprint,
        },
      );
      await f.finish(accepted.job_id);
      const result = await getEntity(f.e, f.a.actor, o.x.id);
      assertEquals(result.properties, {
        prop_1: "original",
        prop_2: null,
        prop_3: 0,
        prop_4: false,
        prop_5: "",
      });
      assertEquals(result.schema_version, 5);
      assertEquals(result.entity_type_id, o.type.id);
      assertEquals(
        (await getEntity(f.e, f.a.actor, o.deleted.id)).deleted_at !== null,
        true,
      );
      const links = await listConfiguredLinks(f.p, f.a.actor, o.x.id, {
        limit: 100,
      });
      assertEquals(
        links.items.map((r) => r.id).sort(),
        [o.peer.id, o.same.id].sort(),
      );
      assert(
        (await listConfiguredLinks(f.p, f.a.actor, o.peer.id, { limit: 100 })).items
          .some((r) => r.id === o.x.id),
      );
      assertEquals(
        (await getEntityType(f.d, f.a.actor, o.type.id)).next_property_number,
        current.next_property_number,
      );
      const restored = await getEntitySchema(f.d, f.a.actor, {
        type_id: o.type.id,
      });
      assertEquals(restored.schema, { ...o.source.schema, title: "Renamed", "x-icon": "leaf", "x-version": 5 });
      assertEquals(restored.schema.properties, o.source.schema.properties);
      const old = await asUser(
        f.sql,
        f.a.actor.userId,
        (tx) =>
          tx`select id,body,entity_context from app.records where id=any(${
            history.map((r) => r.id)
          }::text[]) order by id`,
      );
      assertEquals(Array.from(old), Array.from(history));
      const list = await listEntities(f.e, f.a.actor, {
        entity_type_id: o.type.id,
        limit: 100,
        sort: "updated_at",
      });
      assert(
        list.items.every((r) => r.entity_type_id === o.type.id && r.current_schema_version === 5),
      );
      const filtered = await listEntities(f.e, f.a.actor, {
        entity_type_id: o.type.id,
        limit: 100,
        filters: [{ key: "prop_3", operator: "eq", value: 0 }],
        sort: { key: "prop_3", direction: "asc" },
      });
      assertEquals(filtered.items.map((r) => r.id), [o.x.id]);

      assertEquals(
        (await listEntitySchemaMigrations(f.d, f.a.actor, {
          type_id: o.type.id,
          limit: 100,
        })).items.length,
        2,
      );
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "recovery detects later values/new/delete/restore/pair/task/record changes with bounded actionable conflicts",
  async () => {
    for (
      const action of [
        "value",
        "tag",
        "new",
        "delete",
        "restore",
        "pair",
        "pair_same",
        "task",
        "record",
      ]
    ) {
      const f = await fixture();
      try {
        const o = await f.original(action),
          x = await getEntity(f.e, f.a.actor, o.x.id);
        if (action === "value") {
          await updateEntity(f.e, f.actor(), x.id, {
            expected_version: x.version,
            schema_version: 3,
            properties: { prop_1: "new value" },
          });
        }
        if (action === "tag") {
          const tag = await createTag(
            { uow: new SqlTagUnitOfWork(f.sql) },
            f.actor(),
            {
              scope: "entity",
              name: "later tag",
            },
          );
          await updateEntity(f.e, f.actor(), x.id, {
            expected_version: x.version,
            schema_version: 3,
            tag_ids: [tag.id],
          });
        }
        if (action === "pair_same") {
          const same = await getEntity(f.e, f.a.actor, o.same.id);
          await changeConfiguredRelation(f.p, f.actor(), x.id, {
            other_id: same.id,
            expected_version: x.version,
            expected_other_version: same.version,
          }, false);
        }
        if (action === "new") {
          await createEntity(f.e, f.actor(), {
            entity_type_id: o.type.id,
            schema_version: 3,
            properties: { prop_1: "new" },
          });
        }
        if (action === "delete") {
          await deleteEntity(f.e, f.actor(), x.id, x.version);
        }
        if (action === "restore") {
          const del = await getEntity(f.e, f.a.actor, o.deleted.id);
          await createEntity(f.e, f.actor(), {
            entity_type_id: del.entity_type_id,
            schema_version: 3,
            source: del.source,
            external_id: del.external_id,
            properties: del.properties,
            expected_version: del.version,
          });
        }
        if (action === "pair") {
          const peer = await getEntity(f.e, f.a.actor, o.peer.id);
          await changeConfiguredRelation(f.p, f.actor(), peer.id, {
            other_id: x.id,
            expected_version: peer.version,
            expected_other_version: x.version,
          }, false);
        }
        if (action === "task") {
          await updateTask(f.activity, f.actor(), o.task.id, {
            expected_version: o.task.version,
            entity_ids: [],
          });
        }
        if (action === "record") {
          await updateRecord(f.activity, f.actor(), o.record.id, {
            expected_version: o.record.version,
            entity_ids: [],
          });
        }
        assertEquals(
          (await getEntitySchemaMigration(f.d, f.a.actor, o.job.job_id))
            .recovery?.status,
          "conflict",
        );
        const err = await code(
          () => f.recovery(o.job.job_id),
          "schema_plan_stale",
        );
        assert(err.fields?.length);
        assert(err.fields.length <= 21);
      } finally {
        await f.cleanup();
      }
    }
  },
);
dbTest(
  "recovery rejects unreviewed changes across creation-analysis and preview-start; archived metadata is preserved and compatible schema needs fresh analysis",
  async () => {
    const f = await fixture();
    try {
      const o = await f.original(),
        c = await f.recovery(o.job.job_id),
        x = await getEntity(f.e, f.a.actor, o.x.id);
      await updateEntity(f.e, f.actor(), x.id, {
        expected_version: x.version,
        schema_version: 3,
        properties: { prop_1: "later" },
      });
      await code(
        () => f.analyze(o.type.id, c.id, c.version),
        "schema_plan_stale",
      );
    } finally {
      await f.cleanup();
    }
    const g = await fixture();
    try {
      const o = await g.original(),
        c = await g.recovery(o.job.job_id),
        ready = await g.analyze(o.type.id, c.id, c.version);
      await updateTask(g.activity, g.actor(), o.task.id, {
        expected_version: o.task.version,
        entity_ids: [],
      });
      await code(
        () =>
          startEntitySchemaMigration(g.d, g.actor(), o.type.id, c.id, {
            expected_change_version: c.version,
            expected_schema_version: c.source_schema_version,
            analysis_id: ready.analysis!.id,
            fingerprint: ready.fingerprint,
          }),
        "schema_plan_stale",
      );
    } finally {
      await g.cleanup();
    }
    const h = await fixture();
    try {
      const o = await h.original(),
        t = await getEntityType(h.d, h.a.actor, o.type.id),
        later = await createEntitySchemaChange(h.d, h.actor(), t.id, {
          expected_schema_version: t.schema_version,
          edits: [{
            op: "add_property",
            client_ref: "later",
            field: { "x-order": 20, type: "string" },
            required: false,
          }],
        });
      const ready = await h.analyze(t.id, later.id, later.version);
      await applyEntitySchemaChange(h.d, h.actor(), t.id, later.id, {
        expected_change_version: later.version,
        analysis_id: ready.analysis!.id,
      });
      const c = await h.recovery(o.job.job_id);
      assert(Object.hasOwn(c.target.schema.properties, "prop_7"));
      assertEquals(c.source_schema_version, 4);
      assertEquals(c.status, "draft");
      const next = await getEntityType(h.d, h.a.actor, t.id);
      await updateEntityType(h.d, h.actor(), t.id, {
        expected_schema_version: next.schema_version,
        archived: true,
      });
      const archivedRecovery = await h.recovery(o.job.job_id);
      assertEquals(archivedRecovery.target.schema.deprecated, true);
      const recovered = await h.accept(t.id, archivedRecovery.id, archivedRecovery.version);
      await h.finish(recovered.job_id);
      const definition = await getEntitySchema(h.d, h.a.actor, { type_id: t.id });
      assertEquals(definition.schema.deprecated, true);
      assertEquals(definition.schema.title, next.label);
      assertEquals(definition.schema["x-icon"], next.icon_id);
      assertEquals(definition.schema["x-version"], 6);
    } finally {
      await h.cleanup();
    }
  },
);
dbTest(
  "recovery clock expiry/missing material; accepted owned source survives expiry cleanup; terminal/orphan cleanup and account cascade",
  async () => {
    const f = await fixture();
    try {
      const o = await f.original(),
        c = await f.recovery(o.job.job_id),
        accepted = await f.accept(o.type.id, c.id, c.version);
      await f
        .admin`update app.entity_schema_migrations set source_expires_at=now()-interval '1 second' where id=${o.job.job_id}`;
      assertEquals(
        (await getEntitySchemaMigration(f.d, f.a.actor, o.job.job_id)).recovery
          ?.status,
        "expired",
      );
      await code(() => f.recovery(o.job.job_id), "migration_source_expired");
      await f.finish(accepted.job_id);
      assertEquals(
        (await getEntitySchemaMigration(f.d, f.a.actor, accepted.job_id))
          .status,
        "succeeded",
      );
      assertEquals(
        (await getEntity(f.e, f.a.actor, o.x.id)).properties.prop_4,
        false,
      );
      const [clean] = await f
        .admin`select count(*)::int as count from private.entity_schema_migration_rows where job_id=${o.job.job_id}`;
      assertEquals(clean.count, 0);
      const other = await f.original("Missing");
      await f
        .admin`delete from private.entity_schema_migration_rows where job_id=${other.job.job_id}`;
      assertEquals(
        (await getEntitySchemaMigration(f.d, f.a.actor, other.job.job_id))
          .recovery?.status,
        "unavailable",
      );
      await code(() => f.recovery(other.job.job_id), "conflict");
      await f
        .admin`update app.entity_schema_analyses set created_at=now()-interval '31 days' where owner_id=${f.a.actor.userId}`;
      await f.worker`select app.claim_entity_schema_migration()`;
      const [rows] = await f
        .admin`select count(*)::int as count from private.entity_schema_analysis_rows r join app.entity_schema_analyses a on a.id=r.analysis_id where a.owner_id=${f.a.actor.userId} and a.created_at<=now()-interval '30 days'`;
      assertEquals(rows.count, 0);
      await f.a.cleanup();
      const [deleted] = await f
        .admin`select (select count(*) from private.entity_schema_migration_rows where owner_id=${f.a.actor.userId})::int as sources,(select count(*) from private.entity_schema_analysis_rows where owner_id=${f.a.actor.userId})::int as analyses`;
      assertEquals(deleted, { sources: 0, analyses: 0 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "recovery final atomic commit rechecks incident selections after staging and does not rewrite values/history",
  async () => {
    const f = await fixture();
    try {
      const o = await f.original(),
        c = await f.recovery(o.job.job_id),
        accepted = await f.accept(o.type.id, c.id, c.version);
      const [claim] = await f
        .worker`select app.claim_entity_schema_migration() as batch`;
      const staged = await prepareMigrationBatch(claim.batch, new Date("2026-10-12T00:00:00Z"));
      assert(!staged.stale);
      await f
        .worker`select app.stage_entity_schema_migration(${accepted.job_id},${claim.batch.fence},${
        f.worker.json(staged.results)
      })`;
      // Privileged fixture injection proves the final RPC gate, beyond the ordinary public write lock.
      await f
        .admin`update app.tasks set entity_ids='{}',entity_context='[]' where id=${o.task.id}`;
      const [final] = await f
        .worker`select app.claim_entity_schema_migration() as batch`;
      const [result] = await f
        .worker`select app.commit_entity_schema_migration(${accepted.job_id},${final.batch.fence},${final.batch.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`;
      assertEquals(result.committed, false);
      assertEquals(
        (await getEntitySchemaMigration(f.d, f.a.actor, accepted.job_id))
          .failure_reason,
        "schema_plan_stale",
      );
      assertEquals(
        (await getEntitySchema(f.d, f.a.actor, { type_id: o.type.id }))
          .schema_version,
        3,
      );
      assertEquals((await getEntity(f.e, f.a.actor, o.x.id)).properties, {
        prop_1: "original",
      });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "recovery near 8 MiB owns exact multibyte copies through analysis acceptance staging and original cleanup",
  async () => {
    const f = await fixture();
    try {
      const o = await f.largeOriginal(66),
        c = await f.recovery(o.job.job_id),
        ready = await f.analyze(o.type.id, c.id, c.version);
      assert(ready.executable);
      const [size] = await f
        .admin`select sum(octet_length(properties::text)+octet_length(recovery_properties::text)+octet_length(after::text))::bigint as bytes from private.entity_schema_analysis_rows where analysis_id=${
        ready.analysis!.id
      }`;
      assert(
        Number(size.bytes) > 7.5 * 1024 * 1024 && Number(size.bytes) <= 8388608,
      );
      const current = await getEntityType(f.d, f.a.actor, o.type.id);
      const accepted = await startEntitySchemaMigration(
        f.d,
        f.actor(),
        o.type.id,
        c.id,
        {
          expected_change_version: c.version,
          expected_schema_version: current.schema_version,
          analysis_id: ready.analysis!.id,
          fingerprint: ready.fingerprint,
        },
      );
      await f
        .admin`update app.entity_schema_migrations set source_expires_at=now()-interval '1 second' where id=${o.job.job_id}`;
      await f.finish(accepted.job_id);
      const list = await listEntities(f.e, f.a.actor, {
        entity_type_id: o.type.id,
        limit: 100,
        sort: "updated_at",
      });
      assertEquals(list.items.length, 66);
      for (const row of list.items) {
        const detail = await getEntity(f.e, f.a.actor, row.id);
        assertEquals(detail.properties.prop_2, "한".repeat(4096));
        assertEquals(detail.properties.prop_6, "구".repeat(4096));
        assertEquals(detail.schema_version, 4);
        assertEquals(detail.version, 3);
      }
      assertEquals(
        (await getEntitySchemaMigration(f.d, f.a.actor, accepted.job_id))
          .status,
        "succeeded",
      );
      const [source] = await f
        .admin`select count(*)::int as count from private.entity_schema_migration_rows where job_id=${o.job.job_id}`;
      assertEquals(source.count, 0);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "recovery owned-copy analysis rejects over 8 MiB without changing properties schema history or acquiring a write lock",
  async () => {
    const f = await fixture();
    try {
      const o = await f.largeOriginal(70), c = await f.recovery(o.job.job_id);
      const before = await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`);
      const ready = await f.analyze(o.type.id, c.id, c.version);
      assertEquals(ready.analysis?.status, "failed");
      assertEquals(ready.analysis?.failure_reason, "analysis_result_limit");
      assertEquals(ready.executable, false);
      const t = await getEntityType(f.d, f.a.actor, o.type.id);
      await code(
        () =>
          startEntitySchemaMigration(f.d, f.actor(), o.type.id, c.id, {
            expected_change_version: c.version,
            expected_schema_version: t.schema_version,
            analysis_id: ready.analysis!.id,
            fingerprint: ready.fingerprint,
          }),
        "schema_plan_stale",
      );
      assertEquals(await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`), before);
      assertEquals(
        (await getEntitySchema(f.d, f.a.actor, { type_id: o.type.id }))
          .schema_version,
        3,
      );
      const [state] = await f
        .admin`select schema_write_locked,(select count(*) from app.entity_schema_migrations where change_id=${c.id})::int as jobs,(select count(*) from app.records where owner_id=${f.a.actor.userId})::int as records from app.entity_types where id=${o.type.id}`;
      assertEquals(state, { schema_write_locked: false, jobs: 0, records: 70 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "recovery start preflights multibyte generated records in 8 MiB and rejects before accepting or locking",
  async () => {
    const f = await fixture();
    try {
      const o = await f.largeOriginal(66);
      await updateBusinessSettings(
        {
          uow: new SqlBusinessSettingsUnitOfWork(f.sql),
          clock: f.activity.clock,
        },
        f.actor(),
        {
          id: "record_templates",
          expected_version: 1,
          value: {
            entity_types: {
              [o.type.id]: {
                update: { memo: "한".repeat(22000), tag_ids: [] },
              },
            },
          },
        },
      );
      const c = await f.recovery(o.job.job_id), ready = await f.analyze(o.type.id, c.id, c.version);
      const before = await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`),
        t = await getEntityType(f.d, f.a.actor, o.type.id);
      assert(ready.executable);
      await code(() =>
        startEntitySchemaMigration(f.d, f.actor(), o.type.id, c.id, {
          expected_change_version: c.version,
          expected_schema_version: t.schema_version,
          analysis_id: ready.analysis!.id,
          fingerprint: ready.fingerprint,
        }), "invalid_input");
      const [jobs] = await f
        .admin`select count(*)::int as count from app.entity_schema_migrations where type_id=${o.type.id}`;
      assertEquals(jobs.count, 1);
      assertEquals(await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`), before);
      assertEquals(
        (await getEntitySchema(f.d, f.a.actor, { type_id: o.type.id }))
          .schema_version,
        3,
      );
      const [state] = await f
        .admin`select schema_write_locked,(select count(*) from app.records where owner_id=${f.a.actor.userId})::int as records from app.entity_types where id=${o.type.id}`;
      assertEquals(state, { schema_write_locked: false, records: 66 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "recovery start counts owned copies plus large multibyte templates and rejects without a job lock or half change",
  async () => {
    const f = await fixture();
    try {
      const o = await f.largeOriginal(68);
      await updateBusinessSettings(
        {
          uow: new SqlBusinessSettingsUnitOfWork(f.sql),
          clock: f.activity.clock,
        },
        f.actor(),
        {
          id: "record_templates",
          expected_version: 1,
          value: {
            entity_types: {
              [o.type.id]: {
                update: { memo: "한".repeat(22000), tag_ids: [] },
              },
            },
          },
        },
      );
      const c = await f.recovery(o.job.job_id),
        ready = await f.analyze(o.type.id, c.id, c.version);
      assert(ready.executable);
      const before = await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`),
        t = await getEntityType(f.d, f.a.actor, o.type.id);
      const [captured] = await f
        .admin`select sum(octet_length(properties::text)+octet_length(recovery_properties::text)+octet_length(after::text))::bigint as bytes from private.entity_schema_analysis_rows where analysis_id=${
        ready.analysis!.id
      }`;
      assert(Number(captured.bytes) <= 8388608);
      assert(Number(captured.bytes) + 66000 > 8388608);
      await code(
        () =>
          startEntitySchemaMigration(f.d, f.actor(), o.type.id, c.id, {
            expected_change_version: c.version,
            expected_schema_version: t.schema_version,
            analysis_id: ready.analysis!.id,
            fingerprint: ready.fingerprint,
          }),
        "invalid_input",
      );
      assertEquals(await getEntity(f.e, f.a.actor, `app:${o.type.id}:1`), before);
      assertEquals(
        (await getEntitySchema(f.d, f.a.actor, { type_id: o.type.id }))
          .schema_version,
        3,
      );
      const [state] = await f
        .admin`select schema_write_locked,(select count(*) from app.entity_schema_migrations where change_id=${c.id})::int as jobs,(select count(*) from app.records where owner_id=${f.a.actor.userId})::int as records from app.entity_types where id=${o.type.id}`;
      assertEquals(state, { schema_write_locked: false, jobs: 0, records: 68 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("recovery expiry uses wallclock after type/template lock waits and before acceptance", async () => {
  for (const phase of ["type", "template-create", "template-start"] as const) {
    const f = await fixture();
    try {
      const o = await f.original(phase), before = await getEntity(f.e, f.a.actor, o.x.id);
      const c = phase === "template-start" ? await f.recovery(o.job.job_id) : null;
      const ready = c ? await f.analyze(o.type.id, c.id, c.version) : null;
      const [counts] = await f
        .admin`select (select count(*)::int from app.entity_schema_changes where type_id=${o.type.id}) changes,(select count(*)::int from app.entity_schema_migrations where type_id=${o.type.id}) jobs`;
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => acquired = resolve),
        untilRelease = new Promise<void>((resolve) => release = resolve);
      const hold = f.admin.begin(async (tx) => {
        if (phase === "type") {
          await tx`select id from app.entity_types where id=${o.type.id} for update`;
          await tx`update app.entity_types set schema_write_locked=true where id=${o.type.id}`;
        } else await tx`select pg_advisory_xact_lock(hashtextextended(${`${f.a.actor.userId}:record_templates`},0))`;
        await tx`update app.entity_schema_migrations set source_expires_at=clock_timestamp()+interval '1 second' where id=${o.job.job_id}`;
        // Commit expiry before template waits; type-lock case publishes it on release.
        acquired();
        await untilRelease;
      });
      await locked;
      // Template cases need a committed source expiry before the application obtains its job lock.
      if (phase !== "type") {
        release();
        await hold;
      }
      let unlockTemplate!: () => void, secondLocked: Promise<unknown> | null = null;
      if (phase !== "type") {
        let signal!: () => void;
        const taken = new Promise<void>((resolve) => signal = resolve),
          wait = new Promise<void>((resolve) => unlockTemplate = resolve);
        secondLocked = f.admin.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtextextended(${`${f.a.actor.userId}:record_templates`},0))`;
          signal();
          await wait;
        });
        await taken;
      }
      const result = (phase === "template-start"
        ? startEntitySchemaMigration(f.d, f.actor(), o.type.id, c!.id, {
          expected_change_version: c!.version,
          expected_schema_version: ready!.source_schema_version,
          analysis_id: ready!.analysis!.id,
          fingerprint: ready!.fingerprint,
        })
        : f.recovery(o.job.job_id)).then(() => ({ code: "accepted" }), (error) => ({ code: (error as AppError).code }));
      try {
        await f.admin`select pg_sleep(1.2)`;
      } finally {
        if (phase === "type") {
          release();
          await hold;
        } else {
          unlockTemplate();
          await secondLocked;
        }
      }
      assertEquals((await result).code, "migration_source_expired");
      const [after] = await f
        .admin`select (select count(*)::int from app.entity_schema_changes where type_id=${o.type.id}) changes,(select count(*)::int from app.entity_schema_migrations where type_id=${o.type.id}) jobs`;
      assertEquals(after, counts);
      assertEquals(await getEntity(f.e, f.a.actor, o.x.id), before);
      const [gate] = await f.admin`select schema_write_locked from app.entity_types where id=${o.type.id}`;
      assertEquals(gate.schema_write_locked, phase === "type");
    } finally {
      await f.cleanup();
    }
  }
});
