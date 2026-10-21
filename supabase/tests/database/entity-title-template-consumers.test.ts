import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import { entityCreate, entityListQuery } from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { renderEntityTitle } from "../../functions/_shared/contracts/entity-title-template.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activities from "../../functions/_shared/core/activity/application.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { createEntityRelationDefinition } from "../../functions/_shared/core/entity-relations/application.ts";
import { listEntityRelationLinks } from "../../functions/_shared/core/entity-relations/links.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 1, prepare: false });

dbTest("entity title SQL and public read semantics agree for scalar, Unicode, escape and length cases", async () => {
  const { schema } = initialEntityDefinition("고객명");
  Object.assign(schema.properties, {
    prop_2: { type: "string", "x-order": 20 },
    prop_3: { type: "boolean", "x-order": 30 },
    prop_4: { type: "number", "x-order": 40 },
    prop_5: {
      type: ["string", "null"],
      "x-order": 50,
      oneOf: [{ const: "a", title: "진행 중" }, { const: null, title: "미정" }],
    },
    prop_6: { type: "string", format: "date", "x-order": 60 },
  });
  const cases: Array<{ template: string; properties: Record<string, unknown>; expected: string }> = [
    {
      template: "$prop_1$ - $prop_2$",
      properties: { prop_1: "초록상점", prop_2: "서울" },
      expected: "초록상점 - 서울",
    },
    {
      template: "$prop_1$ / $prop_3$ / $prop_4$ / $prop_5$ / $prop_6$ / $$",
      properties: { prop_1: "<상점>", prop_3: false, prop_4: 0, prop_5: "a", prop_6: "2024-02-29" },
      expected: "<상점> / 아니오 / 0 / 진행 중 / 2024-02-29 / $",
    },
    {
      template: "${prop_1$} $prop_5$ $prop_3$",
      properties: { prop_1: "초록", prop_5: null, prop_3: true },
      expected: "초록 미정 예",
    },
    { template: "$prop_1$", properties: {}, expected: "자료-1" },
    {
      template: "$prop_1$",
      properties: {
        prop_1:
          "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
      },
      expected: "자료-1",
    },
    { template: " $prop_1$ ", properties: { prop_1: " 초록 " }, expected: "  초록  " },
    { template: "고정 제목", properties: {}, expected: "고정 제목" },
    { template: "$prop_1$ 끝", properties: { prop_1: "😀".repeat(4096) }, expected: "😀".repeat(4095) + "…" },
    {
      template: "$prop_1$$prop_2$",
      properties: { prop_1: " ".repeat(4096), prop_2: "뒤의 내용" },
      expected: " ".repeat(4095) + "…",
    },
  ];
  for (const item of cases) {
    schema["x-title-template"] = item.template;
    assertEquals(renderEntityTitle(schema, item.properties, "자료-1"), item.expected);
    const [row] = await admin.begin(async (tx) => {
      await tx`set local role app_user`;
      return tx`select app.entity_title(${tx.json(schema as never)},${
        tx.json(item.properties as never)
      },'자료-1') as title`;
    });
    assertEquals(row.title, item.expected);
  }
  // PostgreSQL numeric scale is not a user-visible distinction from JSON Number.
  schema["x-title-template"] = "$prop_4$";
  const [numeric] = await admin`select app.entity_title(${
    admin.json(schema as never)
  },'{"prop_4":1.2500}'::jsonb,'자료-1') as title`;
  assertEquals(numeric.title, "1.25");
});

dbTest(
  "title publication updates current get/list/search/relation/task references while preserving saved facts",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const ed = { uow: new SqlEntityUnitOfWork(user) };
    const ad = { uow: new SqlUnitOfWork(user), clock: { now: () => new Date() } };
    const model = { uow: new SqlDataModelUnitOfWork(user) };
    try {
      const kind = await fixture.createKind("제목 템플릿 검증");
      await fixture.grant(fixture.manager, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "tasks", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "write" },
      ]);
      const actor = fixture.manager;
      const publish = async (template: string, addRegion = false) => {
        const document = await exportDataModel(model, actor);
        const definition = document.entity_types.find((item) => item.schema["x-type-id"] === kind.id)!;
        if (addRegion) definition.schema.properties.prop_2 = { type: "string", title: "지역", "x-order": 20 };
        definition.schema["x-title-template"] = template;
        const input = { mode: "update", document: JSON.stringify(document) };
        const review = await previewDataModel(model, actor, input);
        const change = await prepareDataModel(model, businessRequest(actor), {
          ...input,
          preview_fingerprint: review.fingerprint,
        });
        assertEquals(
          (await applyDataModel(model, businessRequest(actor), change.id, { expected_version: change.version })).status,
          "applied",
        );
      };
      await publish("$prop_1$ - $prop_2$", true);
      const saved = [];
      for (const region of ["서울", "부산", "부산"]) {
        saved.push(
          await entities.createEntity(
            ed,
            businessRequest(actor),
            entityCreate.parse({
              entity_type_id: kind.id,
              schema_version: 2,
              source: "app",
              external_id: crypto.randomUUID(),
              properties: { prop_1: "초록상점", prop_2: region },
            }),
          ),
        );
      }
      assertEquals(saved[0].title, "초록상점 - 서울");
      const query = entityListQuery.parse({ entity_type_id: kind.id, sort: "title", limit: 1 });
      const firstPage = await entities.listEntities(ed, actor, query);
      const ids = firstPage.items.map((row) => row.id);
      let page = firstPage;
      while (page.next_cursor) {
        page = await entities.listEntities(ed, actor, { ...query, cursor: page.next_cursor });
        ids.push(...page.items.map((row) => row.id));
      }
      assertEquals(ids, [...saved.slice(1).map((item) => item.id).sort(), saved[0].id]);
      assertEquals(
        (await entities.listEntities(ed, actor, entityListQuery.parse({ entity_type_id: kind.id, keyword: " - 서울" })))
          .items.map((row) => row.id),
        [saved[0].id],
      );
      const searched = await search(
        { uow: new SqlSearchUnitOfWork(user) },
        actor,
        searchInput.parse({ query: " - 서울", kinds: ["entity"], mode: "keyword" }),
      );
      assertEquals(searched.items.map((row) => [row.id, row.title]), [[saved[0].id, "초록상점 - 서울"]]);
      const relation = await createEntityRelationDefinition(
        { uow: new SqlEntityRelationDefinitionUnitOfWork(user) },
        businessRequest(actor),
        {
          ends: [{ type_id: kind.id, label: "원점", cardinality: "many" }, {
            type_id: kind.id,
            label: "상대",
            cardinality: "many",
          }],
        },
      );
      const candidates = await listEntityRelationLinks({ uow: new SqlEntityRelationLinkUnitOfWork(user) }, actor, {
        definition_id: relation.id,
        origin_id: saved[1].id,
        side: 0,
        q: " - 서울",
        limit: 100,
      }, true);
      assertEquals(candidates.items.map((row) => [row.id, row.title]), [[saved[0].id, "초록상점 - 서울"]]);
      const task = await activities.createTask(
        ad,
        businessRequest(actor),
        taskCreate.parse({ kind: "once", title: "연결 검증", entity_ids: [saved[0].id] }),
      );
      assertEquals(task.entity_context[0].title, "초록상점 - 서울");
      const before = await entities.getEntity(ed, actor, saved[0].id);
      const oldRecord = await activities.getRecord(ad, actor, before.records.items[0].id);
      assertEquals(oldRecord.change?.target_title, "초록상점 - 서울");
      const [captureBefore] =
        await admin`select entity_context from app.tasks where workspace_id=${fixture.workspaceId} and id=${task.id}`;
      const [queueBefore] =
        await admin`select count(*)::int as n from pgmq.q_search_index where message->>'workspace_id'=${fixture.workspaceId} and message->>'kind'='entity'`;
      await publish("$prop_2$ / $prop_1$");
      const after = await entities.getEntity(ed, actor, saved[0].id);
      assertEquals(after.title, "서울 / 초록상점");
      assertEquals(after.properties, before.properties);
      assertEquals(after.version, before.version);
      assertEquals((await activities.getTask(ad, actor, task.id)).entity_context[0].title, "서울 / 초록상점");
      assertEquals(await activities.getRecord(ad, actor, oldRecord.id), oldRecord);
      const [captureAfter] =
        await admin`select entity_context from app.tasks where workspace_id=${fixture.workspaceId} and id=${task.id}`;
      assertEquals(captureAfter, captureBefore);
      const [queueAfter] =
        await admin`select count(*)::int as n from pgmq.q_search_index where message->>'workspace_id'=${fixture.workspaceId} and message->>'kind'='entity'`;
      assertEquals(queueAfter.n, queueBefore.n);
      assertEquals(
        (await entities.listEntities(ed, actor, entityListQuery.parse({ entity_type_id: kind.id, keyword: " - 서울" })))
          .items,
        [],
      );
      assertEquals(
        (await search(
          { uow: new SqlSearchUnitOfWork(user) },
          actor,
          searchInput.parse({ query: "서울 /", kinds: ["entity"], mode: "keyword" }),
        )).items.map((row) => row.title),
        ["서울 / 초록상점"],
      );
      assertEquals(
        (await assertRejects(
          () => entities.listEntities(ed, actor, { ...query, cursor: firstPage.next_cursor! }),
          AppError,
        )).code,
        "invalid_input",
      );
      await fixture.grantKind(fixture.manager, kind.id, "none");
      assertEquals(
        (await search(
          { uow: new SqlSearchUnitOfWork(user) },
          actor,
          searchInput.parse({ query: "서울 /", kinds: ["entity"], mode: "keyword" }),
        )).items,
        [],
      );
      assertEquals((await activities.getTask(ad, actor, task.id)).entity_context, []);
    } finally {
      await fixture.cleanup();
    }
  },
);
