import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { assert, assertEquals } from "@std/assert";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import {
  applyDataModel,
  exportDataModel,
  getDataModelChange,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 3, prepare: false });
const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 3, prepare: false });
const vector = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);

dbTest(
  "workspace entity search: published selected text alone reaches the scoped worker without truncation",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    try {
      const kind = await fixture.createKind("선택 본문 검증");
      await fixture.grantKind(fixture.manager, kind.id, "write");
      await fixture.grantKind(fixture.member, kind.id, "write");
      const model = { uow: new SqlDataModelUnitOfWork(user) };
      const document = await exportDataModel(model, fixture.manager);
      const definition = document.entity_types.find((item) => item.schema["x-type-id"] === kind.id)!;
      definition.schema.properties.prop_1["x-search-text"] = true;
      definition.schema.properties.prop_1.title = "검색 제목";
      definition.schema.properties.prop_3 = {
        type: ["string", "null"],
        title: "설명",
        "x-order": 30,
        default: null,
        "x-search-text": true,
      };
      definition.schema.properties.prop_4 = {
        type: ["string", "null"],
        title: "선택하지 않은 메모",
        "x-order": 40,
        default: null,
      };
      const input = { mode: "update", document: JSON.stringify(document) };
      const review = await previewDataModel(model, fixture.manager, input);
      const change = await prepareDataModel(
        model,
        businessRequest(fixture.manager),
        {
          ...input,
          preview_fingerprint: review.fingerprint,
        },
      );
      assertEquals(
        (await applyDataModel(
          model,
          businessRequest(fixture.manager),
          change.id,
          {
            expected_version: change.version,
          },
        )).status,
        "applied",
      );
      const longText = "긴 한국어😀문장 ".repeat(220) + "후반 근거 끝";
      const original = await entities.createEntity(
        { uow: new SqlEntityUnitOfWork(user) },
        businessRequest(fixture.member),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 2,
          properties: {
            prop_1: "선택 자료",
            prop_3: longText,
            prop_4: "전송하지 않을 비밀",
          },
        }),
      );
      const sent: string[] = [];
      const result = await indexBatch(
        new SqlIndexQueue(worker),
        new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
          send(text) {
            sent.push(text);
            return Promise.resolve({ state: "succeeded", vector });
          },
        }, "a".repeat(64)),
        {
          limit: 1,
          workspace_id: fixture.workspaceId,
          kind: "entity",
          id: original.id,
        },
      );
      assertEquals(result.indexed, 1);
      assert(sent.length > 1);
      assert(sent.some((text) => text.includes("검색 제목")));
      assert(sent.some((text) => text.includes("선택 자료")));
      assert(sent.some((text) => text.includes("설명")));
      assert(sent.some((text) => text.endsWith("후반 근거 끝")));
      assertEquals(
        sent.some((text) =>
          text.includes("전송하지 않을 비밀") ||
          text.includes("선택하지 않은 메모")
        ),
        false,
      );
      const retained = await entities.getEntity(
        { uow: new SqlEntityUnitOfWork(user) },
        fixture.member,
        original.id,
      );
      assertEquals(retained.properties, original.properties);
    } finally {
      // Only this fixture's in-process fake sends are cleaned up; production
      // uncertain effects remain retained by the worker protocol.
      const ownedEffects =
        await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
      for (const effect of ownedEffects) {
        await admin`delete from private.passage_effects where id=${effect.id}::uuid`;
      }
      await fixture.cleanup();
    }
  },
);

// A single model publication owns all affected kinds, including compatible
// selected-text changes. Revoking either kind fences every queued child source.
dbTest(
  "workspace entity search: compatible model publication retains its complete affected-kind footprint",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    try {
      const first = await fixture.createKind("모델 첫 종류");
      const second = await fixture.createKind("모델 두 번째 종류");
      await fixture.grantKind(fixture.manager, first.id, "write");
      await fixture.grantKind(fixture.manager, second.id, "write");
      const model = { uow: new SqlDataModelUnitOfWork(user) };
      const publish = async (label: string) => {
        const document = await exportDataModel(model, fixture.manager);
        for (const type of document.entity_types) {
          type.schema.properties.prop_1["x-search-text"] = true;
          type.schema.properties.prop_1.title = label;
        }
        const input = { mode: "update", document: JSON.stringify(document) };
        const review = await previewDataModel(model, fixture.manager, input);
        const change = await prepareDataModel(
          model,
          businessRequest(fixture.manager),
          {
            ...input,
            preview_fingerprint: review.fingerprint,
          },
        );
        assertEquals(
          (await applyDataModel(
            model,
            businessRequest(fixture.manager),
            change.id,
            {
              expected_version: change.version,
            },
          )).status,
          "applied",
        );
      };
      await publish("처음 검색 이름");
      const entityDeps = { uow: new SqlEntityUnitOfWork(user) };
      const original = await entities.createEntity(
        entityDeps,
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: first.id,
          schema_version: 2,
          properties: { prop_1: "전체 모델 권한으로 준비한 자료" },
        }),
      );
      await entities.createEntity(
        entityDeps,
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: second.id,
          schema_version: 2,
          properties: { prop_1: "함께 게시한 다른 종류" },
        }),
      );
      await publish("게시한 검색 이름");
      await fixture.grantKind(fixture.manager, second.id, "none");
      let sends = 0;
      const result = await indexBatch(
        new SqlIndexQueue(worker),
        new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
          send() {
            sends++;
            return Promise.resolve({ state: "succeeded", vector });
          },
        }, "a".repeat(64)),
        {
          limit: 1,
          workspace_id: fixture.workspaceId,
          kind: "entity",
          id: original.id,
        },
      );
      assertEquals(result.claimed, 0);
      assertEquals(sends, 0);
      assertEquals(
        (await entities.getEntity(entityDeps, fixture.manager, original.id))
          .properties.prop_1,
        "전체 모델 권한으로 준비한 자료",
      );
    } finally {
      const ownedEffects =
        await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
      for (const effect of ownedEffects) {
        await admin`delete from private.passage_effects where id=${effect.id}::uuid`;
      }
      await fixture.cleanup();
    }
  },
);

dbTest(
  "workspace entity search: selection rename/removal fences late workers and edit/delete/restore exposes only current text",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let running: ReturnType<typeof indexBatch> | undefined;
    try {
      const kind = await fixture.createKind("검색 수명 검증");
      await fixture.grantKind(fixture.manager, kind.id, "write");
      await fixture.grantKind(fixture.member, kind.id, "write");
      const model = { uow: new SqlDataModelUnitOfWork(user) };
      const publish = async (rename: boolean) => {
        const document = await exportDataModel(model, fixture.manager);
        const type = document.entity_types.find((entry) => entry.schema["x-type-id"] === kind.id)!;
        type.schema.properties.prop_1["x-search-text"] = true;
        type.schema.properties.prop_1.title = rename ? "바뀐 이름" : "처음 이름";
        type.schema.properties.prop_3 = {
          type: ["string", "null"],
          title: "해제할 본문",
          "x-order": 30,
          default: null,
          "x-search-text": !rename,
        };
        const input = { mode: "update", document: JSON.stringify(document) };
        const review = await previewDataModel(model, fixture.manager, input);
        const change = await prepareDataModel(model, businessRequest(fixture.manager), {
          ...input,
          preview_fingerprint: review.fingerprint,
        });
        assertEquals(
          (await applyDataModel(model, businessRequest(fixture.manager), change.id, {
            expected_version: change.version,
          })).status,
          "applied",
        );
      };
      await publish(false);
      const entityDeps = { uow: new SqlEntityUnitOfWork(user) };
      const external_id = "한글 원본/😀";
      const original = await entities.createEntity(
        entityDeps,
        businessRequest(fixture.member),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 2,
          properties: {
            prop_1: "처음 값",
            prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, external_id),
            prop_3: "선택 해제할 비밀",
          },
        }),
      );
      const queue = new SqlIndexQueue(worker), ledger = new SqlExternalEffectLedger(worker);
      const scope = { limit: 1, workspace_id: fixture.workspaceId, kind: "entity", id: original.id };
      const oldSent: string[] = [], currentSent: string[] = [];
      const delayed = new DurablePassageEmbedder(ledger, {
        async send(text) {
          oldSent.push(text);
          entered.resolve();
          await release.promise;
          return { state: "succeeded", vector };
        },
      }, "a".repeat(64));
      running = indexBatch(queue, delayed, scope);
      await Promise.race([
        entered.promise,
        running.then(() => {
          throw Error("old generation never reached fake provider");
        }),
      ]);
      await publish(true);
      release.resolve();
      assertEquals((await running).stale, 1);
      // That text was legitimately sent before deselection; it cannot be recalled.
      assert(oldSent.some((text) => text.includes("선택 해제할 비밀")));
      const current = new DurablePassageEmbedder(ledger, {
        send(text) {
          currentSent.push(text);
          return Promise.resolve({ state: "succeeded", vector });
        },
      }, "a".repeat(64));
      assertEquals((await indexBatch(queue, current, scope)).indexed, 1);
      assertEquals(currentSent, ["바뀐 이름\n처음 값"]);
      const changed = await entities.updateEntity(
        entityDeps,
        businessRequest(fixture.member),
        original.id,
        entityUpdate.parse({
          expected_version: original.version,
          schema_version: 3,
          properties: { prop_1: "편집한 값", prop_3: "선택 해제할 비밀" },
        }),
      );
      assertEquals((await indexBatch(queue, current, scope)).indexed, 1);
      assertEquals(currentSent.at(-1), "바뀐 이름\n편집한 값");
      await entities.deleteEntity(entityDeps, businessRequest(fixture.member), original.id, changed.version);
      assertEquals((await indexBatch(queue, current, scope)).claimed, 0);
      const searchDeps = { uow: new SqlSearchUnitOfWork(user) };
      const lookup = (query: string) =>
        search(searchDeps, fixture.member, searchInput.parse({ query, kinds: ["entity"], mode: "keyword" }));
      assertEquals((await lookup("편집한 값")).items, []);
      const restored = await entities.restoreEntity(entityDeps, businessRequest(fixture.member), original.id, {
        schema_version: 3,
        expected_version: changed.version + 1,
        properties: { prop_1: "복원한 값", prop_3: "선택 해제할 비밀" },
      });
      assertEquals(restored.id, original.id);
      assertEquals((await indexBatch(queue, current, scope)).indexed, 1);
      const result = await lookup("복원한 값");
      assertEquals(result.items.length, 1);
      assertEquals(result.items[0].id, original.id);
      assertEquals(result.items[0].path, `/entities/${encodeURIComponent(original.id)}`);
      assertEquals(result.items[0].source_fields?.map((field) => field.key), ["prop_1"]);
      assertEquals(result.items[0].index_state, "indexed");
      assertEquals((await lookup("선택 해제할 비밀")).items, []);
      assertEquals(
        (await entities.getEntity(entityDeps, fixture.member, original.id)).properties.prop_3,
        "선택 해제할 비밀",
      );
    } finally {
      release.resolve();
      await running?.catch(() => {});
      const ownedEffects =
        await admin`select id from private.passage_effects where workspace_id=${fixture.workspaceId}`;
      for (const effect of ownedEffects) await admin`delete from private.passage_effects where id=${effect.id}::uuid`;
      await fixture.cleanup();
    }
  },
);

for (const failLate of [false, true]) {
  dbTest(
    failLate
      ? "workspace entity search: late durable publication failure rolls back selected text state queue and receipts"
      : "workspace entity search: durable two-kind publication captures selected text and the whole conversion footprint",
    async () => {
      const fixture = await businessWorkspaceFixture(admin, user);
      try {
        const kinds = [
          await fixture.createKind("변환 검색 첫 종류"),
          await fixture.createKind("변환 검색 두 번째 종류"),
        ];
        const entityDeps = { uow: new SqlEntityUnitOfWork(user) };
        const originals: Awaited<ReturnType<typeof entities.createEntity>>[] = [];
        for (const kind of kinds) {
          await fixture.grantKind(fixture.manager, kind.id, "write");
          originals.push(
            await entities.createEntity(
              entityDeps,
              businessRequest(fixture.manager),
              entityCreate.parse({
                entity_type_id: kind.id,
                schema_version: 1,
                properties: { prop_1: "변환 전 긴 제목" },
              }),
            ),
          );
        }
        const model = { uow: new SqlDataModelUnitOfWork(user, SqlDataModelGroupStore) };
        const beforeDocument = await exportDataModel(model, fixture.manager);
        const document = structuredClone(beforeDocument);
        for (const type of document.entity_types) {
          type.schema.properties.prop_1.maxLength = 1;
          type.schema.properties.prop_1.title = "변환 검색 제목";
          type.schema.properties.prop_1["x-search-text"] = true;
        }
        const input = { mode: "update", document: JSON.stringify(document) };
        const preview = await previewDataModel(model, fixture.manager, input);
        const saved = await prepareDataModel(model, businessRequest(fixture.manager), {
          ...input,
          preview_fingerprint: preview.fingerprint,
        });
        assertEquals(saved.status, "needs_conversion");
        assertEquals(
          (await analyzeDataModel(model, businessRequest(fixture.manager), saved.id, {
            expected_version: saved.version,
            conversions: document.entity_types.map((type) => ({
              type_ref: type.ref,
              migration: {
                rules: [],
                overrides: [{
                  entity_id: originals[kinds.findIndex((kind) => kind.id === type.schema["x-type-id"])].id,
                  key: "prop_1",
                  value: "값",
                }],
              },
            })),
          })).status,
          "analyzing",
        );
        for (let step = 0; step < 2; step++) {
          const [{ batch }] = await worker`select app.claim_entity_schema_analysis() as batch`;
          assert(batch);
          const convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
          const results = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
            convert(row.entity_id, row.properties)
          );
          assertEquals(
            (await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
              worker.json(results)
            }) as accepted`)[0].accepted,
            true,
          );
        }
        const ready = await getDataModelChange(model, fixture.manager, saved.id);
        assertEquals(ready.status, "ready");
        assertEquals(
          (await applyDataModel(model, businessRequest(fixture.manager), saved.id, {
            expected_version: ready.version,
          })).status,
          "queued",
        );
        const snapshot = async () => ({
          state:
            await admin`select * from app.search_index_state where workspace_id=${fixture.workspaceId} order by kind,id`,
          queue:
            await admin`select * from pgmq.q_search_index where message->>'workspace_id'=${fixture.workspaceId} order by msg_id`,
          chunks:
            await admin`select * from app.search_chunks where workspace_id=${fixture.workspaceId} order by source_kind,source_id,ordinal`,
          receipts:
            await admin`select * from private.workspace_request_results where workspace_id=${fixture.workspaceId} and executor_id=${fixture.manager.userId} order by request_key`,
        });
        const beforeCommit = await snapshot();
        const beforeRecords = (await admin`select id from app.records where workspace_id=${fixture.workspaceId}`)
          .map((record) => record.id as string);
        for (let step = 0; step < 4; step++) {
          const [{ batch }] = await worker`select app.claim_data_model_conversion() as batch`;
          assert(batch);
          if (batch.status === "committing") {
            if (failLate) {
              // The second child's automatic record collides after the first child
              // has already published its selected projection inside the savepoint.
              const [collision] =
                await admin`select r.record_id,r.entity_id,r.record_body from app.data_model_children c
              join private.entity_schema_migration_rows r on r.workspace_id=c.workspace_id and r.job_id=c.job_id
              where c.workspace_id=${fixture.workspaceId} and c.model_id=${saved.id} order by c.type_id desc limit 1`;
              await admin.begin(async (tx) => {
                await tx`select set_config('request.workspace_id',${fixture.workspaceId},true)`;
                await tx`insert into app.records(workspace_id,owner_id,id,entity_id,created_by,body,record_kind,change_metadata)
                values(${fixture.workspaceId},null,${collision.record_id},${collision.entity_id},${fixture.manager.userId},${collision.record_body},'change',${
                  tx.json({
                    event_id: collision.record_id,
                    target_kind: "entity",
                    target_id: collision.entity_id,
                    target_title: "의도한 충돌",
                    action: "update",
                    source: "http",
                    before: null,
                    after: null,
                    path: null,
                  })
                })`;
              });
              assertEquals(
                (await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`)[
                  0
                ].committed,
                false,
              );
              assertEquals((await getDataModelChange(model, fixture.manager, saved.id)).status, "failed");
              assertEquals(await exportDataModel(model, fixture.manager), beforeDocument);
              for (const original of originals) {
                const retained = await entities.getEntity(entityDeps, fixture.manager, original.id);
                assertEquals(retained.properties, original.properties);
                assertEquals(retained.version, original.version);
                assertEquals(retained.schema_version, original.schema_version);
              }
              assertEquals(await snapshot(), beforeCommit);
              assertEquals(
                (await admin`select id from app.records where workspace_id=${fixture.workspaceId}`)
                  .map((record) => record.id as string).sort(),
                [...beforeRecords, collision.record_id].sort(),
              );
              return;
            }
            assertEquals(
              (await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`)[
                0
              ].committed,
              true,
            );
            break;
          }
          const prepared = await prepareMigrationBatch(batch.child, new Date());
          assertEquals(prepared.stale, false);
          assertEquals(
            (await worker`select app.stage_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},${
              worker.json(prepared.results)
            }) as accepted`)[0].accepted,
            true,
          );
        }
        assertEquals((await getDataModelChange(model, fixture.manager, saved.id)).status, "applied");
        for (const original of originals) {
          assertEquals((await entities.getEntity(entityDeps, fixture.manager, original.id)).properties.prop_1, "값");
        }
        const sent: string[] = [];
        const queue = new SqlIndexQueue(worker);
        const embedder = new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
          send(text) {
            sent.push(text);
            return Promise.resolve({ state: "succeeded", vector });
          },
        }, "a".repeat(64));
        assertEquals(
          (await indexBatch(queue, embedder, {
            limit: 1,
            workspace_id: fixture.workspaceId,
            kind: "entity",
            id: originals[0].id,
          })).indexed,
          1,
        );
        assertEquals(sent, ["변환 검색 제목\n값"]);
        await fixture.grantKind(fixture.manager, kinds[0].id, "none");
        const denied = await indexBatch(queue, embedder, {
          limit: 1,
          workspace_id: fixture.workspaceId,
          kind: "entity",
          id: originals[1].id,
        });
        assertEquals(denied.claimed, 0);
        assertEquals(sent.length, 1);
        assertEquals((await entities.getEntity(entityDeps, fixture.manager, originals[1].id)).properties.prop_1, "값");
      } finally {
        await fixture.cleanup();
      }
    },
  );
}
