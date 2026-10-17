import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlCreateAndLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/create-and-link-store.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
} from "../../functions/_shared/core/entity/application.ts";
import { listRecords } from "../../functions/_shared/core/activity/application.ts";
import { createEntityRelationDefinition } from "../../functions/_shared/core/entity-relations/application.ts";
import { connectEntityRelation, listEntityRelationLinks } from "../../functions/_shared/core/entity-relations/links.ts";
import { createAndLinkEntity } from "../../functions/_shared/core/entity-relations/create-and-link.ts";
import { entityListQuery } from "../../functions/_shared/contracts/entity.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

dbTest(
  "atomic create-and-link preserves defaults, final versions, replay and rolls creation/link/records back on late failure",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 3 }),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const d = { uow: new SqlCreateAndLinkUnitOfWork(sql) },
      definitions = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      links = { uow: new SqlEntityRelationLinkUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) },
      entities = { uow: new SqlEntityUnitOfWork(sql) },
      activity = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
    try {
      const order = await createEntityType(types, requestActor(a.actor), { label: "주문" }),
        line = await createEntityType(types, requestActor(a.actor), { label: "주문품목" });
      const draft = await createEntitySchemaChange(types, requestActor(a.actor), line.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "server",
          field: { type: "integer", "x-order": 20, readOnly: true, default: 7 },
        }, { op: "add_property", client_ref: "quantity", field: { type: "integer", "x-order": 30, default: 5 } }],
      });
      const analysis = await analyzeEntitySchemaChange(types, requestActor(a.actor), line.id, draft.id, {
        expected_change_version: draft.version,
      });
      await applyEntitySchemaChange(types, requestActor(a.actor), line.id, draft.id, {
        expected_change_version: draft.version,
        analysis_id: analysis.analysis_id,
      });
      const def = await createEntityRelationDefinition(definitions, requestActor(a.actor), {
        ends: [{ type_id: order.id, label: "주문품목", cardinality: "one" }, {
          type_id: line.id,
          label: "소속 주문",
          cardinality: "one",
        }],
      });
      const origin = await createEntity(entities, requestActor(a.actor), {
        entity_type_id: order.id,
        schema_version: 1,
        properties: { prop_1: "원점 주문" },
      });
      const input = {
        definition_id: def.id,
        side: 0,
        origin_id: origin.id,
        expected_definition_version: 1,
        expected_version: 1,
        previous_other_id: null,
        expected_previous_version: null,
        entity: { entity_type_id: line.id, schema_version: 2, identity_version: 1, properties: { prop_1: "첫 품목" } },
      };
      const actor = requestActor(a.actor), saved = await createAndLinkEntity(d, actor, input);
      assertEquals(saved.entity.properties, { prop_1: "첫 품목", prop_2: 7, prop_3: 5 });
      assertEquals(saved.entity.version, 2);
      assertMatch(saved.entity.external_id, /^\d{8}-[0-9A-Z]{8}$/);
      assertEquals(await createAndLinkEntity(d, actor, input), saved);
      assertEquals((await getEntity(entities, a.actor, saved.entity.id)).version, 2);
      const before = (await listRecords(activity, a.actor, recordListQuery.parse({ limit: 100 }))).items.map((r) =>
        r.id
      ).sort();
      const replace = {
        ...input,
        expected_version: 2,
        previous_other_id: saved.entity.id,
        expected_previous_version: 2,
        entity: { ...input.entity, properties: { prop_1: "롤백 확인" } },
        change_tag_ids: [crypto.randomUUID()],
      };
      await assertRejects(() => createAndLinkEntity(d, requestActor(a.actor), replace), AppError);
      assertEquals(
        (await listEntities(
          entities,
          a.actor,
          entityListQuery.parse({ entity_type_id: line.id, keyword: "롤백 확인" }),
        )).items,
        [],
      );
      assertEquals(
        (await listEntityRelationLinks(links, a.actor, { definition_id: def.id, side: 0, origin_id: origin.id })).items
          .map((e) => e.id),
        [saved.entity.id],
      );
      assertEquals((await getEntity(entities, a.actor, origin.id)).version, 2);
      assertEquals(
        (await listRecords(activity, a.actor, recordListQuery.parse({ limit: 100 }))).items.map((r) => r.id).sort(),
        before,
      );
      assertEquals(
        (await assertRejects(() => createAndLinkEntity(d, requestActor(b.actor), input), AppError)).code,
        "not_found",
      );
      assertEquals((await listEntities(entities, b.actor, entityListQuery.parse({}))).items, []);
      const stale = { ...replace, change_tag_ids: undefined };
      assertEquals(
        (await assertRejects(
          () =>
            createAndLinkEntity(d, requestActor(a.actor), { ...stale, entity: { ...stale.entity, schema_version: 1 } }),
          AppError,
        )).code,
        "schema_changed",
      );
      assertEquals(
        (await assertRejects(() =>
          createAndLinkEntity(d, requestActor(a.actor), {
            ...stale,
            entity: { ...stale.entity, identity_version: 99 },
          }), AppError)).code,
        "settings_changed",
      );
      assertEquals(
        (await assertRejects(() =>
          createAndLinkEntity(d, requestActor(a.actor), {
            ...stale,
            entity: { ...stale.entity, external_id: saved.entity.external_id },
          }), AppError)).code,
        "conflict",
      );
      const races = await Promise.allSettled(
        ["경합 A", "경합 B"].map((title) =>
          createAndLinkEntity(d, requestActor(a.actor), {
            ...stale,
            entity: { ...stale.entity, properties: { prop_1: title } },
          })
        ),
      );
      assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
      assertEquals(
        (await listEntities(entities, a.actor, entityListQuery.parse({ entity_type_id: line.id, keyword: "경합" })))
          .items.length,
        1,
      );
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest("failed create-and-link restoration retains deleted child and both existing single relationships", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct), a = await fixtureOwner(admin);
  const d = { uow: new SqlCreateAndLinkUnitOfWork(sql) },
    definitions = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
    links = { uow: new SqlEntityRelationLinkUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) },
    entities = { uow: new SqlEntityUnitOfWork(sql) },
    activity = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
  try {
    const type = await createEntityType(types, requestActor(a.actor), { label: "자료" });
    const def = await createEntityRelationDefinition(definitions, requestActor(a.actor), {
      ends: [{ type_id: type.id, label: "상대", cardinality: "one" }, {
        type_id: type.id,
        label: "원점",
        cardinality: "one",
      }],
    });
    const values: Awaited<ReturnType<typeof createEntity>>[] = [];
    for (const title of ["원점1", "원점2", "상대1", "상대2"]) {
      values.push(
        await createEntity(entities, requestActor(a.actor), {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: title },
        }),
      );
    }
    for (const [origin, other] of [[values[0], values[2]], [values[1], values[3]]]) {
      await connectEntityRelation(links, requestActor(a.actor), {
        definition_id: def.id,
        side: 0,
        origin_id: origin.id,
        other_id: other.id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      });
    }
    await deleteEntity(entities, requestActor(a.actor), values[3].id, 2);
    const deleted = await getEntity(entities, a.actor, values[3].id),
      before = (await listRecords(activity, a.actor, recordListQuery.parse({ limit: 100 }))).items.map((r) => r.id)
        .sort();
    await assertRejects(() =>
      createAndLinkEntity(d, requestActor(a.actor), {
        definition_id: def.id,
        side: 0,
        origin_id: values[0].id,
        expected_definition_version: 1,
        expected_version: 2,
        previous_other_id: values[2].id,
        expected_previous_version: 2,
        entity: {
          entity_type_id: type.id,
          schema_version: 1,
          source: deleted.source,
          external_id: deleted.external_id,
          expected_version: deleted.version,
          properties: { prop_1: "복원 시도" },
        },
      }), AppError);
    assertEquals(await getEntity(entities, a.actor, deleted.id), deleted);
    assertEquals(
      (await listEntityRelationLinks(links, a.actor, { definition_id: def.id, side: 0, origin_id: values[0].id })).items
        .map((e) => e.id),
      [values[2].id],
    );
    assertEquals(
      (await listRecords(activity, a.actor, recordListQuery.parse({ limit: 100 }))).items.map((r) => r.id).sort(),
      before,
    );
  } finally {
    await a.cleanup();
    await sql.end();
    await admin.end();
  }
});
