import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import { encodeIdentifierValue } from "../../functions/_shared/contracts/entity-identifiers.ts";
import { changeConfiguredRelation, configuredRelationFixture } from "./_configured-relations.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import {
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { runEntityReset } from "../../../scripts/entity-reset.mjs";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import {
  analyzeEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { startEntitySchemaMigration } from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 3, prepare: false });
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
const taskDeps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("explicit entity reset preserves workspace and tasks, expires receipts and fences stale approval", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    await f.grant(f.manager, [{ target_kind: "settings", target_id: "*", access: "write" }, {
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    const type = await f.createKind("초기화 대상");
    await f.grantKind(f.manager, type.id, "write");
    const createActor = businessRequest(f.manager);
    const input = { entity_type_id: type.id, schema_version: 1, properties: { prop_1: "보존하지 않을 자료" } };
    const entity = await entities.createEntity(entityDeps, createActor, input);
    const task = await activity.createTask(taskDeps, businessRequest(f.manager), {
      title: "보존할 할 일",
      body: "",
      kind: "once",
      entity_ids: [entity.id],
    });
    const other = await activity.createTask(taskDeps, businessRequest(f.manager), {
      title: "무관한 할 일",
      body: "",
      kind: "once",
    });
    const target = new URL(urls.admin);
    const manifest = {
      run_id: crypto.randomUUID(),
      project_id: "isolated-entity-reset",
      source_revision: "c9475b76".padEnd(40, "0"),
      environment: { host: target.hostname, port: Number(target.port), database: target.pathname.slice(1) },
      scopes: [{ workspace_id: f.workspaceId, actor_id: f.manager.userId, entity_ids: [entity.id] }],
    };
    const before = await admin`select * from app.workspaces where id=${f.workspaceId}`;
    const plan = await runEntityReset(admin, manifest);
    assertEquals(plan.mode, "plan");
    assertEquals(plan.blockers, []);
    assertEquals((await admin`select id from app.entities where workspace_id=${f.workspaceId}`).length, 1);
    await entities.updateEntity(entityDeps, businessRequest(f.manager), entity.id, {
      schema_version: 1,
      expected_version: entity.version,
      properties: { prop_1: "변경" },
    });
    await assertRejects(() => runEntityReset(admin, manifest, plan), Error, "plan changed");
    const change = await createEntitySchemaChange(f.typeDeps, businessRequest(f.manager), type.id, {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "count",
        field: { type: "integer", title: "수량", "x-order": 30 },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_3", value: 7 }], overrides: [] },
    });
    await analyzeEntitySchemaChange(f.typeDeps, businessRequest(f.manager), type.id, change.id, {
      expected_change_version: change.version,
    });
    const workerUrl = new URL(urls.admin);
    workerUrl.username = "app_worker";
    workerUrl.password = Deno.env.get("APP_WORKER_PASSWORD")!;
    const worker = connect(workerUrl.href, { max: 1, prepare: false });
    try {
      for (let n = 0; n < 10; n++) {
        const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!claimed.batch) break;
        const batch = claimed.batch, convert = compileMigration(batch.target, batch.migration);
        await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
          worker.json(batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(r.entity_id, r.properties)
          ))
        })`;
      }
      const ready = await getEntitySchemaChange(f.typeDeps, f.manager, type.id, change.id);
      assert(ready.analysis);
      await startEntitySchemaMigration(f.typeDeps, businessRequest(f.manager), type.id, change.id, {
        expected_schema_version: 1,
        expected_change_version: ready.version,
        analysis_id: ready.analysis.id,
        fingerprint: ready.fingerprint,
      });
      const [claimed] = await worker`select app.claim_entity_schema_migration() as batch`;
      assert(claimed.batch);
      const [record] =
        await admin`select id from app.records where workspace_id=${f.workspaceId} and entity_id=${entity.id} order by id limit 1`;
      const fake = new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
        send() {
          return Promise.resolve({ state: "unknown" as const, reason: "provider_unknown" });
        },
      }, "b".repeat(64));
      assertEquals(
        (await indexBatch(new SqlIndexQueue(worker), fake, {
          limit: 1,
          workspace_id: f.workspaceId,
          kind: "record",
          id: record.id,
        })).retry,
        1,
      );
      const blocked = await runEntityReset(admin, manifest);
      assert(blocked.blockers.some((b: { reason: string }) => b.reason === "unresolved_effect"));
      await assertRejects(() => runEntityReset(admin, manifest, blocked), Error, "blocked");
      // Only this test's in-process fake provider is settled administratively.
      // The tool has no override to discard an actual uncertain external call.
      await admin`update private.passage_effects set state='failed',lease_until=null where workspace_id=${f.workspaceId} and source_kind='record' and source_id=${record.id}`;
      const messages =
        await admin`select msg_id from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} and message->>'id'=${record.id}`;
      for (const message of messages) await admin`select pgmq.archive('search_index',${message.msg_id}::bigint)`;
    } finally {
      await worker.end();
    }
    const fresh = await runEntityReset(admin, manifest);
    assertEquals(fresh.counts["app.entity_schema_migrations"], 1);
    assertEquals(fresh.counts["private.entity_schema_analysis_rows"], 1);
    assert(fresh.counts["pgmq.a_search_index"] > 0);
    assertEquals(fresh.counts["private.passage_effects"], 1);
    const result = await runEntityReset(admin, manifest, fresh);
    assertEquals(result.mode, "applied");
    assertEquals(result.residual_rows, 0);
    assertEquals(
      (await admin`select id from app.entity_schema_migrations where workspace_id=${f.workspaceId}`).length,
      0,
    );
    const [typeAfter] =
      await admin`select schema_write_locked from app.entity_types where workspace_id=${f.workspaceId} and id=${type.id}`;
    assertEquals(typeAfter.schema_write_locked, false);
    assertEquals(await admin`select * from app.workspaces where id=${f.workspaceId}`, before);
    assertEquals(
      (await admin`select id from app.tasks where workspace_id=${f.workspaceId}`).map((r) => r.id).sort(),
      [task.id, other.id].sort(),
    );
    const [saved] =
      await admin`select entity_ids,entity_context from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
    assertEquals(saved.entity_ids, []);
    assertEquals(saved.entity_context, []);
    const [receipt] =
      await admin`select completed_at,result,fingerprint from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
        createActor.request!.key
      }`;
    assert(receipt.completed_at && receipt.fingerprint);
    assertEquals(receipt.result, null);
    const error = await assertRejects(() => entities.createEntity(entityDeps, createActor, input));
    assertEquals((error as { code?: string }).code, "result_expired");
    assertEquals((await runEntityReset(admin, manifest, fresh)).mode, "already-clean");
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "entity reset keeps each workspace actor for relation deletion and preserves unrelated literal lookalikes",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const foreign = await f.addWorkspace("두 번째 초기화 공간");
      await f.grant(f.manager, [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      await f.grant(foreign.member, [{ target_kind: "settings", target_id: "*", access: "write" }]);
      const fixture = configuredRelationFixture(sql);
      const scopes = [];
      let firstEntity = "";
      for (const actor of [f.manager, foreign.member]) {
        const type = await f.createKind("연결 자료", actor);
        await f.grantKind(actor, type.id, "write");
        const left = await entities.createEntity(entityDeps, businessRequest(actor), {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: "왼쪽", prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "L") },
        });
        const right = await entities.createEntity(entityDeps, businessRequest(actor), {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: "오른쪽", prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "R") },
        });
        await changeConfiguredRelation(fixture, businessRequest(actor), left.id, {
          other_id: right.id,
          expected_version: left.version,
          expected_other_version: right.version,
        }, true);
        scopes.push({ workspace_id: actor.workspaceId, actor_id: actor.userId, entity_ids: [left.id, right.id] });
        firstEntity ||= left.id;
      }
      const unrelatedActor = businessRequest(f.manager);
      await activity.createTask(taskDeps, unrelatedActor, {
        title: "단순 문자열 본문",
        body: firstEntity,
        kind: "once",
      });
      const [unrelatedReceipt] =
        await admin`select * from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          unrelatedActor.request!.key
        }`;
      const emptyType = await f.createKind("보존할 빈 종류");
      await f.grantKind(f.manager, emptyType.id, "write");
      const change = await createEntitySchemaChange(f.typeDeps, businessRequest(f.manager), emptyType.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "unrelated",
          field: {
            type: "string",
            "x-order": 30,
            title: firstEntity,
            default: firstEntity,
            oneOf: [{ const: firstEntity, title: "일반 코드" }],
          },
          required: false,
        }],
        migration: { rules: [], overrides: [] },
      });
      const modelDeps = { uow: new SqlDataModelUnitOfWork(sql) };
      const document = await exportDataModel(modelDeps, f.manager);
      document.entity_types.find((t) => t.schema["x-type-id"] === emptyType.id)!.schema.description = firstEntity;
      document.relations = [];
      const input = { mode: "update" as const, document: JSON.stringify(document) };
      const preview = await previewDataModel(modelDeps, f.manager, input);
      const model = await prepareDataModel(modelDeps, businessRequest(f.manager), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      const [changeBefore] =
        await admin`select * from app.entity_schema_changes where workspace_id=${f.workspaceId} and id=${change.id}`;
      const [modelBefore] =
        await admin`select * from app.data_model_changes where workspace_id=${f.workspaceId} and id=${model.id}`;
      const target = new URL(urls.admin);
      const manifest = {
        run_id: crypto.randomUUID(),
        project_id: "isolated-multiscope-reset",
        source_revision: "a".repeat(40),
        environment: { host: target.hostname, port: Number(target.port), database: target.pathname.slice(1) },
        scopes,
      };
      const invalidActor = { ...manifest, scopes: [{ ...scopes[0], actor_id: f.member.userId }, scopes[1]] };
      const invalidPlan = await runEntityReset(admin, invalidActor);
      const denied = await assertRejects(() => runEntityReset(admin, invalidActor, invalidPlan));
      assertEquals(
        (denied as { code?: string }).code,
        "42501",
        "the manifest actor must pass the existing workspace guard",
      );
      assertEquals(
        (await admin`select * from app.entity_relation_links where workspace_id=any(${
          scopes.map((s) => s.workspace_id)
        }::uuid[])`).length,
        2,
      );
      const plan = await runEntityReset(admin, manifest);
      assertEquals(plan.blockers, []);
      assertEquals(
        plan.counts["app.entity_schema_changes"],
        0,
        "a text/default equal to the removed key is not a reference",
      );
      assertEquals(
        plan.counts["app.data_model_changes"],
        0,
        "a source definition or free-text value is not an affected target kind",
      );
      assertEquals((await runEntityReset(admin, manifest, plan)).mode, "applied");
      assertEquals(
        (await admin`select * from app.entity_relation_links where workspace_id=any(${
          scopes.map((s) => s.workspace_id)
        }::uuid[])`).length,
        0,
      );
      assertEquals(
        (await admin`select * from app.entities where workspace_id=any(${scopes.map((s) => s.workspace_id)}::uuid[])`)
          .length,
        0,
      );
      assertEquals(
        (await admin`select id from app.workspaces where id=any(${scopes.map((s) => s.workspace_id)}::uuid[])`).length,
        2,
      );
      assertEquals(
        (await admin`select * from app.entity_schema_changes where workspace_id=${f.workspaceId} and id=${change.id}`)[
          0
        ],
        changeBefore,
      );
      assertEquals(
        (await admin`select * from app.data_model_changes where workspace_id=${f.workspaceId} and id=${model.id}`)[0],
        modelBefore,
      );
      assertEquals(
        (await admin`select * from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          unrelatedActor.request!.key
        }`)[0],
        unrelatedReceipt,
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "post-cutover reset clears only fresh scoped entity references and preserves compatible definitions and task result bodies",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const type = await f.createKind("현재 정의 보존");
      await f.grant(f.manager, [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }, { target_kind: "entity_type", target_id: type.id, access: "write" }]);
      const attempt = businessRequest(f.manager),
        input = { entity_type_id: type.id, schema_version: 1, properties: { prop_1: "초기화 자료" } };
      const entity = await entities.createEntity(entityDeps, attempt, input);
      const task = await activity.createTask(taskDeps, businessRequest(f.manager), {
        kind: "once",
        title: "보존할 업무",
        body: "원문 보존",
        entity_ids: [entity.id],
      });
      const result = await activity.completeTask(taskDeps, businessRequest(f.manager), task.id, {
        expected_version: task.version,
        body: "보존할 수행 결과",
      });
      const before =
        await admin`select * from app.records where workspace_id=${f.workspaceId} and id=${result.record.id}`;
      const definitions =
        await admin`select * from app.entity_schema_versions where workspace_id=${f.workspaceId} order by type_id,schema_version`;
      const registry =
        await admin`select * from app.entity_identifier_rules where workspace_id=${f.workspaceId} order by id`;
      const target = new URL(urls.admin);
      const manifest = {
        run_id: crypto.randomUUID(),
        project_id: "post-cutover-fixture",
        source_revision: "a".repeat(40),
        environment: { host: target.hostname, port: Number(target.port), database: target.pathname.slice(1) },
        scopes: [{ workspace_id: f.workspaceId, actor_id: f.manager.userId, entity_ids: [entity.id] }],
      };
      const plan = await runEntityReset(admin, manifest);
      assertEquals(plan.blockers, []);
      assertEquals((await runEntityReset(admin, manifest, plan)).mode, "applied");
      assertEquals((await runEntityReset(admin, manifest, plan)).mode, "already-clean");
      assertEquals(
        (await entities.listEntities(entityDeps, f.manager, { entity_type_id: type.id, limit: 20, sort: "updated_at" }))
          .items,
        [],
      );
      assertEquals((await activity.getTask(taskDeps, f.manager, task.id)).entity_ids, []);
      assertEquals(
        await admin`select * from app.records where workspace_id=${f.workspaceId} and id=${result.record.id}`,
        before,
      );
      assertEquals(
        await admin`select * from app.entity_schema_versions where workspace_id=${f.workspaceId} order by type_id,schema_version`,
        definitions,
      );
      assertEquals(
        await admin`select * from app.entity_identifier_rules where workspace_id=${f.workspaceId} order by id`,
        registry,
      );
      assertEquals(
        (await assertRejects(() => entities.createEntity(entityDeps, attempt, input), AppError)).code,
        "result_expired",
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("reset fails closed when a required current store is missing", async () => {
  const name = "reset_missing_" + crypto.randomUUID().replaceAll("-", "");
  let isolated: ReturnType<typeof connect> | undefined;
  try {
    await admin`create database ${admin(name)} template template0`;
    const url = new URL(urls.admin);
    url.pathname = "/" + name;
    isolated = connect(url.href, { max: 1 });
    await isolated`create schema app`;
    await isolated`create schema private`;
    const manifest = {
      run_id: crypto.randomUUID(),
      project_id: "missing-store-fixture",
      source_revision: "b".repeat(40),
      environment: { host: url.hostname, port: Number(url.port), database: name },
      scopes: [{ workspace_id: crypto.randomUUID(), actor_id: crypto.randomUUID(), entity_ids: [] }],
    };
    await assertRejects(
      () => runEntityReset(isolated!, manifest),
      Error,
      "required reset table is missing: app.entities",
    );
  } finally {
    await isolated?.end();
    await admin`drop database if exists ${admin(name)} with(force)`;
  }
});

dbTest(
  "explicit incompatible definition retirement preserves registry and grants and rejects protected grant references",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const retired = await f.createKind("명시 폐기 정의"), compatible = await f.createKind("호환 정의 보존");
      await f.grantKind(f.manager, retired.id, "write");
      // A predecessor-shaped definition belongs only to this disposable fixture.
      // Normal reset runs with every FK/trigger enabled; no guard is bypassed by reset.
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role=replica`;
        await tx`update app.entity_schema_versions set schema=schema-'x-identity-property'
        where workspace_id=${f.workspaceId} and type_id=${retired.id}`;
      });
      const target = new URL(urls.admin),
        manifest = {
          run_id: crypto.randomUUID(),
          project_id: "retired-definition-fixture",
          source_revision: "c".repeat(40),
          environment: { host: target.hostname, port: Number(target.port), database: target.pathname.slice(1) },
          scopes: [{
            workspace_id: f.workspaceId,
            actor_id: f.manager.userId,
            entity_ids: [],
            retire_definitions: [{ type_id: retired.id, expected_schema_version: 1, schema_versions: [1] }],
          }],
        };
      const grants =
        await admin`select * from private.workspace_grants where workspace_id=${f.workspaceId} order by user_id,target_kind,target_id`;
      const blocked = await runEntityReset(admin, manifest);
      assert(blocked.blockers.some((b: { reason: string }) => b.reason === "definition_has_preserved_grants"));
      await assertRejects(() => runEntityReset(admin, manifest, blocked), Error, "reset blocked");
      assertEquals(
        await admin`select * from private.workspace_grants where workspace_id=${f.workspaceId} order by user_id,target_kind,target_id`,
        grants,
      );
      // The fixture owner explicitly removes its own fixture-only kind grant through
      // the public permission usecase. The reset itself never edits permissions.
      await f.grant(f.manager, [{ target_kind: "settings", target_id: "*", access: "write" }]);
      const preserved =
        await admin`select * from private.workspace_grants where workspace_id=${f.workspaceId} order by user_id,target_kind,target_id`;
      const registry =
        await admin`select * from app.entity_identifier_rules where workspace_id=${f.workspaceId} order by id`;
      const schema =
        await admin`select * from app.entity_schema_versions where workspace_id=${f.workspaceId} and type_id=${compatible.id}`;
      const plan = await runEntityReset(admin, manifest);
      assertEquals(plan.blockers, []);
      assertEquals(plan.counts["app.entity_types"], 1);
      assertEquals(plan.counts["app.entity_schema_versions"], 1);
      assertEquals((await runEntityReset(admin, manifest, plan)).mode, "applied");
      assertEquals((await runEntityReset(admin, manifest, plan)).mode, "already-clean");
      assertEquals(
        (await admin`select id from app.entity_types where workspace_id=${f.workspaceId} and id=${retired.id}`).length,
        0,
      );
      assertEquals(
        await admin`select * from app.entity_schema_versions where workspace_id=${f.workspaceId} and type_id=${compatible.id}`,
        schema,
      );
      assertEquals(
        await admin`select * from app.entity_identifier_rules where workspace_id=${f.workspaceId} order by id`,
        registry,
      );
      assertEquals(
        await admin`select * from private.workspace_grants where workspace_id=${f.workspaceId} order by user_id,target_kind,target_id`,
        preserved,
      );
    } finally {
      await f.cleanup();
    }
  },
);
