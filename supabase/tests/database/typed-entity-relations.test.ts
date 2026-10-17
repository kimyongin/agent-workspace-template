import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import { createEntity, deleteEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { createEntityRelationDefinition } from "../../functions/_shared/core/entity-relations/application.ts";
import {
  connectEntityRelation,
  listEntityRelationLinks,
  replaceEntityRelation,
  unlinkEntityRelation,
} from "../../functions/_shared/core/entity-relations/links.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

dbTest(
  "typed relations enforce both single slots, explicit replacement, replay and preserved deleted counterparts",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 4 }),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const definitions = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      d = { uow: new SqlEntityRelationLinkUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) },
      entities = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(a.actor), { label: "상품" });
      const def = await createEntityRelationDefinition(definitions, requestActor(a.actor), {
        ends: [{ type_id: type.id, label: "원본", cardinality: "one" }, {
          type_id: type.id,
          label: "대체",
          cardinality: "one",
        }],
      });
      const items = [] as Awaited<ReturnType<typeof createEntity>>[];
      for (const title of ["가", "나", "다", "라"]) {
        items.push(
          await createEntity(entities, requestActor(a.actor), {
            entity_type_id: type.id,
            schema_version: 1,
            properties: { prop_1: title },
          }),
        );
      }
      const input = {
        definition_id: def.id,
        side: 0,
        origin_id: items[0].id,
        other_id: items[1].id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      };
      const writer = requestActor(a.actor), saved = await connectEntityRelation(d, writer, input);
      assertEquals(saved.changed, true);
      assertEquals(await connectEntityRelation(d, writer, input), saved);
      assertEquals(
        (await listEntityRelationLinks(d, a.actor, { definition_id: def.id, side: 0, origin_id: items[0].id })).items
          .map((e) => e.id),
        [items[1].id],
      );
      assertEquals(
        (await listEntityRelationLinks(d, a.actor, { definition_id: def.id, side: 1, origin_id: items[1].id })).items
          .map((e) => e.id),
        [items[0].id],
      );
      assertEquals(
        (await assertRejects(
          () => listEntityRelationLinks(d, b.actor, { definition_id: def.id, side: 0, origin_id: items[0].id }),
          AppError,
        )).code,
        "not_found",
      );
      // Reverse-role single slot remains occupied by another origin, even with fresh entity versions.
      assertEquals(
        (await assertRejects(() =>
          connectEntityRelation(d, requestActor(a.actor), {
            ...input,
            origin_id: items[2].id,
            expected_other_version: 2,
          }), AppError)).code,
        "conflict",
      );
      await assertRejects(() =>
        asUser(
          sql,
          a.actor.userId,
          (tx) =>
            tx`insert into app.entity_relation_links(owner_id,definition_id,left_entity_id,right_entity_id) values(${a.actor.userId},${def.id},${
              items[2].id
            },${items[1].id})`,
        )
      );
      const remove = await deleteEntity(entities, requestActor(a.actor), items[1].id, 2);
      void remove;
      const deleted = await getEntity(entities, a.actor, items[1].id);
      assertEquals(
        (await listEntityRelationLinks(d, a.actor, { definition_id: def.id, side: 0, origin_id: items[0].id })).items[0]
          .deleted_at !== null,
        true,
      );
      assertEquals(
        (await assertRejects(
          () =>
            connectEntityRelation(d, requestActor(a.actor), { ...input, other_id: items[2].id, expected_version: 2 }),
          AppError,
        )).code,
        "conflict",
      );
      const replaced = await replaceEntityRelation(d, requestActor(a.actor), {
        ...input,
        other_id: items[2].id,
        expected_version: 2,
        previous_other_id: items[1].id,
        expected_previous_version: deleted.version,
      });
      assertEquals(
        replaced.endpoint_versions.find((e) => e.id === items[2].id)?.version,
        2,
      );
      assertEquals(
        (await listEntityRelationLinks(d, a.actor, { definition_id: def.id, side: 0, origin_id: items[0].id })).items
          .map((e) => e.id),
        [items[2].id],
      );
      assertEquals(
        (await assertRejects(() =>
          replaceEntityRelation(d, requestActor(a.actor), {
            ...input,
            other_id: items[3].id,
            expected_version: 3,
            previous_other_id: null,
            expected_previous_version: null,
          }), AppError)).code,
        "conflict",
      );
      await unlinkEntityRelation(d, requestActor(a.actor), {
        ...input,
        other_id: items[2].id,
        expected_version: 3,
        expected_other_version: 2,
      });
      const races = await Promise.allSettled(
        [items[2], items[3]].map((other) =>
          connectEntityRelation(d, requestActor(a.actor), {
            ...input,
            other_id: other.id,
            expected_version: 4,
            expected_other_version: other.id === items[2].id ? 3 : 1,
          })
        ),
      );
      assertEquals(
        races.filter((x) => x.status === "fulfilled").length,
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

dbTest(
  "typed many relations exceed 100, bind page scopes, preserve different meanings and invalidate schema reference baseline",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const definitions = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      d = { uow: new SqlEntityRelationLinkUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) },
      entities = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(a.actor), { label: "재료" });
      const ends = [{ type_id: type.id, label: "구성", cardinality: "many" }, {
        type_id: type.id,
        label: "사용처",
        cardinality: "many",
      }];
      const def = await createEntityRelationDefinition(definitions, requestActor(a.actor), { ends }),
        otherDef = await createEntityRelationDefinition(definitions, requestActor(a.actor), { ends });
      const origin = await createEntity(entities, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "원점" },
      });
      const baseline = await asUser(
        sql,
        a.actor.userId,
        async (tx) =>
          (await tx`select app.entity_schema_reference_baseline(${a.actor.userId},${type.id}) as value`)[0].value,
      );
      let first: string | undefined;
      for (let n = 0; n < 101; n++) {
        const other = await createEntity(entities, requestActor(a.actor), {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: `재료 ${n}` },
        });
        first ??= other.id;
        await connectEntityRelation(d, requestActor(a.actor), {
          definition_id: def.id,
          side: 0,
          origin_id: origin.id,
          other_id: other.id,
          expected_definition_version: 1,
          expected_version: 1 + n,
          expected_other_version: 1,
        });
      }
      const scope = { definition_id: def.id, side: 0, origin_id: origin.id };
      const page = await listEntityRelationLinks(d, a.actor, { ...scope, limit: 100 });
      assertEquals(page.items.length, 100);
      const tail = await listEntityRelationLinks(d, a.actor, { ...scope, limit: 100, cursor: page.next_cursor });
      assertEquals(tail.items.length, 1);
      assertEquals(new Set([...page.items, ...tail.items].map((e) => e.id)).size, 101);
      for (
        const filter of [{ ...scope, side: 1 }, { ...scope, definition_id: otherDef.id }, { ...scope, q: "달라짐" }]
      ) {
        assertEquals(
          (await assertRejects(
            () => listEntityRelationLinks(d, a.actor, { ...filter, cursor: page.next_cursor }),
            AppError,
          )).code,
          "invalid_input",
        );
      }
      assertEquals(
        (await assertRejects(
          () => listEntityRelationLinks(d, b.actor, { ...scope, cursor: page.next_cursor }),
          AppError,
        )).code,
        "invalid_input",
      );
      const candidates = await listEntityRelationLinks(d, a.actor, {
        ...scope,
        definition_id: otherDef.id,
        q: "재료",
        limit: 100,
      }, true);
      assertEquals(candidates.items.length, 100);
      await connectEntityRelation(d, requestActor(a.actor), {
        ...scope,
        definition_id: otherDef.id,
        other_id: first!,
        expected_definition_version: 1,
        expected_version: 102,
        expected_other_version: 2,
      });
      const after = await asUser(
        sql,
        a.actor.userId,
        async (tx) =>
          (await tx`select app.entity_schema_reference_baseline(${a.actor.userId},${type.id}) as value`)[0].value,
      );
      assertEquals(baseline.typed_links, []);
      assertEquals(after.typed_links.length, 102);
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
