import { assert, assertEquals } from "@std/assert";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { connect, dbTest, urls } from "./_db.ts";
import {
  businessRequest,
  businessWorkspaceFixture,
} from "./_workspace-business.ts";

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
      const definition = document.entity_types.find((item) =>
        item.schema["x-type-id"] === kind.id
      )!;
      definition.schema.properties.prop_1["x-search-text"] = true;
      definition.schema.properties.prop_1.title = "검색 제목";
      definition.schema.properties.prop_2 = {
        type: ["string", "null"],
        title: "설명",
        "x-order": 20,
        default: null,
        "x-search-text": true,
      };
      definition.schema.properties.prop_3 = {
        type: ["string", "null"],
        title: "선택하지 않은 메모",
        "x-order": 30,
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
          source: "app",
          external_id: crypto.randomUUID(),
          properties: {
            prop_1: "선택 자료",
            prop_2: longText,
            prop_3: "전송하지 않을 비밀",
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
      async function publish(label: string) {
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
      }
      await publish("처음 검색 이름");
      const entityDeps = { uow: new SqlEntityUnitOfWork(user) };
      const original = await entities.createEntity(
        entityDeps,
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: first.id,
          schema_version: 2,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "전체 모델 권한으로 준비한 자료" },
        }),
      );
      await entities.createEntity(
        entityDeps,
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: second.id,
          schema_version: 2,
          source: "app",
          external_id: crypto.randomUUID(),
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
