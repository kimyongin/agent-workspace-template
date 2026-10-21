import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { configureIdentifierField } from "./_entity.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { createEntityIssuer, createIdentifierRule } from "../../functions/_shared/core/entity-issuers/application.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";

dbTest(
  "direct identifier metadata RPC obeys current-only type grants and settings-authorized schema history",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const type = await f.createKind("과거 식별자 종류"), registry = { uow: new SqlEntityIssuerUnitOfWork(sql) };
      await f.grantKind(f.manager, type.id, "write");
      await createEntityIssuer(registry, businessRequest(f.manager), { code: "history", label: "과거 전용 출처" });
      const kind = await createIdentifierRule(registry, businessRequest(f.manager), "history", {
        label: "과거 전용 번호",
        meaning: "과거 정의에서만 참조하는 번호",
      });
      await configureIdentifierField(sql, f.manager, type.id, {
        allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, kind.id],
        default_kind_id: APP_IDENTIFIER_RULE_ID,
      });
      await configureIdentifierField(sql, f.manager, type.id, {
        allowed_kind_ids: [APP_IDENTIFIER_RULE_ID],
        default_kind_id: APP_IDENTIFIER_RULE_ID,
      });
      const metadata = (actor: typeof f.member, version: number) =>
        runInWorkspace(
          sql,
          actor,
          { mode: "business", requirements: [] },
          async (tx) =>
            (await tx`select app.entity_identifier_kinds(${type.id}::uuid,${version}::integer) as kinds`)[0].kinds,
        );
      await f.grantKind(f.member, type.id, "read");
      assertEquals((await getEntitySchema(f.typeDeps, f.member, { type_id: type.id })).schema_version, 3);
      assertEquals(
        (await metadata(f.member, 3)).map((row: { id: string }) => row.id),
        [APP_IDENTIFIER_RULE_ID],
      );
      await assertRejects(() => getEntitySchema(f.typeDeps, f.member, { type_id: type.id, schema_version: 2 }));
      assertEquals(await metadata(f.member, 2), []);
      await f.grant(f.member, [{ target_kind: "settings", target_id: "*", access: "read" }]);
      assertEquals(
        (await getEntitySchema(f.typeDeps, f.member, { type_id: type.id, schema_version: 2 })).schema_version,
        2,
      );
      const historical = await metadata(f.member, 2);
      assertEquals(
        historical.some((row: { id: string; label: string }) => row.id === kind.id && row.label === "과거 전용 번호"),
        true,
      );
      await f.grant(f.member, []);
      await assertRejects(() => metadata(f.member, 2));
    } finally {
      await f.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

import * as entities from "../../functions/_shared/core/entity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { startEntitySchemaMigration } from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

dbTest(
  "required nullable ordinary identifiers support create update conversion and explicit restoration while absence and selected null remain invalid",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = Deno.env.get("APP_WORKER_PASSWORD")!;
    const worker = connect(workerUrl.href, { max: 1, prepare: false });
    const f = await businessWorkspaceFixture(admin, sql),
      e = { uow: new SqlEntityUnitOfWork(sql) },
      actor = () => businessRequest(f.manager);
    try {
      const type = await f.createKind("필수 nullable 식별자");
      await f.grantKind(f.manager, type.id, "write");
      const ordinary = {
        "x-identifier": { allowed_kind_ids: [APP_IDENTIFIER_RULE_ID], default_kind_id: APP_IDENTIFIER_RULE_ID },
      };
      const initial = await changes.createEntitySchemaChange(f.typeDeps, actor(), type.id, {
        expected_schema_version: 1,
        edits: [
          {
            op: "add_property",
            client_ref: "nullable",
            required: true,
            field: { ...ordinary, type: ["string", "null"], title: "필수 보조 번호", "x-order": 30 },
          },
          {
            op: "add_property",
            client_ref: "optional",
            field: { ...ordinary, type: "string", title: "선택 보조 번호", "x-order": 40 },
          },
        ],
      });
      const initialAnalysis = await changes.analyzeEntitySchemaChange(f.typeDeps, actor(), type.id, initial.id, {
        expected_change_version: initial.version,
      });
      for (let i = 0; i < 5; i++) {
        const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!claimed.batch) break;
        const b = claimed.batch, convert = compileMigration(b.target, b.migration, b.recovery_keys);
        await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
          worker.json(b.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(row.entity_id, row.properties)
          ))
        })`;
      }
      const initialReady = await changes.getEntitySchemaChange(f.typeDeps, f.manager, type.id, initial.id);
      await changes.applyEntitySchemaChange(f.typeDeps, actor(), type.id, initial.id, {
        expected_change_version: initialReady.version,
        analysis_id: initialAnalysis.analysis_id,
      });
      const created = await entities.createEntity(e, actor(), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "원본", prop_3: null },
      });
      assertEquals(created.properties.prop_3, null);
      assertEquals(Object.hasOwn(created.properties, "prop_4"), false);
      const paired = await entities.updateEntity(e, actor(), created.id, {
        schema_version: 2,
        expected_version: created.version,
        properties: { prop_3: APP_IDENTIFIER_RULE_ID + ":ordinary" },
      });
      const cleared = await entities.updateEntity(e, actor(), created.id, {
        schema_version: 2,
        expected_version: paired.version,
        properties: { prop_3: null },
      });
      assertEquals(cleared.properties.prop_3, null);
      const tombstone = await entities.createEntity(e, actor(), {
        entity_type_id: type.id,
        schema_version: 2,
        properties: { prop_1: "보관 자료", prop_3: APP_IDENTIFIER_RULE_ID + ":retained" },
      });
      await entities.deleteEntity(e, actor(), tombstone.id, tombstone.version);
      const conversion = await changes.createEntitySchemaChange(f.typeDeps, actor(), type.id, {
        expected_schema_version: 2,
        edits: [{
          op: "add_property",
          client_ref: "count",
          required: true,
          field: { type: "integer", title: "수량", "x-order": 50 },
        }],
        migration: {
          rules: [{ op: "fill", key: "prop_5", value: 7 }],
          overrides: [{ entity_id: tombstone.id, key: "prop_3", value: null }],
        },
      });
      const analysis = await changes.analyzeEntitySchemaChange(f.typeDeps, actor(), type.id, conversion.id, {
        expected_change_version: conversion.version,
      });
      for (let i = 0; i < 5; i++) {
        const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!claimed.batch) break;
        const b = claimed.batch, convert = compileMigration(b.target, b.migration, b.recovery_keys);
        await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
          worker.json(b.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(row.entity_id, row.properties)
          ))
        })`;
      }
      const ready = await changes.getEntitySchemaChange(f.typeDeps, f.manager, type.id, conversion.id);
      assertEquals(ready.analysis!.failed, 0);
      const accepted = await startEntitySchemaMigration(f.typeDeps, actor(), type.id, conversion.id, {
        expected_schema_version: 2,
        expected_change_version: ready.version,
        analysis_id: analysis.analysis_id,
        fingerprint: ready.fingerprint,
      });
      let committed = false;
      for (let i = 0; i < 5; i++) {
        const [claimed] = await worker`select app.claim_entity_schema_migration() as batch`;
        const b = claimed.batch;
        assertEquals(b.id, accepted.job_id);
        if (b.status === "committing") {
          committed =
            (await worker`select app.commit_entity_schema_migration(${b.id},${b.fence},${b.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`)[
              0
            ].committed;
          break;
        }
        const prepared = await prepareMigrationBatch(b, new Date());
        await worker`select app.stage_entity_schema_migration(${b.id},${b.fence},${worker.json(prepared.results)})`;
      }
      assertEquals(committed, true);
      for (const original of [created, tombstone]) {
        const row = await entities.getEntity(e, f.manager, original.id);
        assertEquals(row.properties.prop_3, null);
        assertEquals(row.properties.prop_2, original.properties.prop_2);
        assertEquals(row.properties.prop_5, 7);
      }
      const deleted = await entities.getEntity(e, f.manager, tombstone.id);
      const restored = await entities.restoreEntity(e, actor(), deleted.id, {
        schema_version: 3,
        expected_version: deleted.version,
        properties: { prop_3: null },
      });
      assertEquals(restored.deleted_at, null);
      assertEquals(restored.properties.prop_3, null);
      for (const patch of ["missing", "selected_null", "nonnull_null"] as const) {
        const error = await assertRejects(() =>
          admin.begin(async (tx) => {
            await tx`select set_config('request.workspace_id',${f.workspaceId},true)`;
            if (
              patch === "missing"
            ) {
              await tx`update app.entities set properties=properties-'prop_3' where workspace_id=${f.workspaceId} and id=${restored.id}`;
            } else if (
              patch === "selected_null"
            ) {
              await tx`update app.entities set properties=jsonb_set(properties,'{prop_2}','null') where workspace_id=${f.workspaceId} and id=${restored.id}`;
            } else {
              await tx`update app.entities set properties=jsonb_set(properties,'{prop_4}','null') where workspace_id=${f.workspaceId} and id=${restored.id}`;
            }
          })
        );
        assertEquals((error as { code: string }).code, "23514");
      }
    } finally {
      await f.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);
