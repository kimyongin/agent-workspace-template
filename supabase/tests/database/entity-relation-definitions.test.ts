import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityRelationDefinitionUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-definition-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntityRelationDefinition,
  deleteEntityRelationDefinition,
  getEntityRelationDefinition,
  listEntityRelationDefinitions,
  updateEntityRelationDefinition,
} from "../../functions/_shared/core/entity-relations/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
dbTest(
  "relation definitions retain ordered roles, permit multiple meanings, isolate owner and bind cursors",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 3 }),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const d = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(a.actor), { label: "상품" });
      const input = {
        ends: [{ type_id: type.id, label: "상위", cardinality: "one" }, {
          type_id: type.id,
          label: "하위",
          cardinality: "many",
        }],
      };
      const writer = requestActor(a.actor), first = await createEntityRelationDefinition(d, writer, input);
      assertEquals(await createEntityRelationDefinition(d, writer, input), first);
      const second = await createEntityRelationDefinition(d, requestActor(a.actor), {
        ends: [{ ...input.ends[0], label: "대체 상품" }, { ...input.ends[1], label: "원 상품" }],
      });
      assertEquals((await getEntityRelationDefinition(d, a.actor, first.id)).ends.map((e) => e.label), [
        "상위",
        "하위",
      ]);
      assertEquals((await listEntityRelationDefinitions(d, b.actor)).items, []);
      assertEquals(
        (await assertRejects(() => getEntityRelationDefinition(d, b.actor, first.id), AppError)).code,
        "not_found",
      );
      const page = await listEntityRelationDefinitions(d, a.actor, { q: "상품", limit: 1 });
      assertEquals(page.items.length, 1);
      const next = await listEntityRelationDefinitions(d, a.actor, { q: "상품", cursor: page.next_cursor, limit: 1 });
      assertEquals(new Set([...page.items, ...next.items].map((x) => x.id)).size, 2);
      for (
        const [actor, filter] of [[a.actor, { q: "상위" }], [b.actor, { q: "상품" }], [a.actor, {
          q: "상품",
          archived: "all",
        }]] as const
      ) {
        assertEquals(
          (await assertRejects(
            () => listEntityRelationDefinitions(d, actor, { ...filter, cursor: page.next_cursor, limit: 1 }),
            AppError,
          )).code,
          "invalid_input",
        );
      }
      const writes = await Promise.allSettled(
        [true, false].map((archived) =>
          updateEntityRelationDefinition(d, requestActor(a.actor), first.id, { expected_version: 1, archived })
        ),
      );
      assertEquals(writes.filter((x) => x.status === "fulfilled").length, 1);
      assertEquals(
        (writes.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code,
        "settings_changed",
      );
      const latest = await getEntityRelationDefinition(d, a.actor, first.id);
      const archived = await updateEntityRelationDefinition(d, requestActor(a.actor), first.id, {
        expected_version: latest.version,
        archived: true,
      });
      assertEquals(archived.archived, true);
      assertEquals((await listEntityRelationDefinitions(d, a.actor, { archived: "archived" })).items.map((x) => x.id), [
        first.id,
      ]);
      const deletion = requestActor(a.actor);
      assertEquals(await deleteEntityRelationDefinition(d, deletion, second.id, { expected_version: 1 }), {
        deleted: true,
      });
      assertEquals(await deleteEntityRelationDefinition(d, deletion, second.id, { expected_version: 1 }), {
        deleted: true,
      });
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

import { asUser } from "./_db.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity } from "../../functions/_shared/core/entity/application.ts";
dbTest("in-use definition rejects kind changes, one shrink and deletion while archiving preserves links", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct), a = await fixtureOwner(admin);
  const d = { uow: new SqlEntityRelationDefinitionUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) },
    entities = { uow: new SqlEntityUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(a.actor), { label: "상품" }),
      other = await createEntityType(types, requestActor(a.actor), { label: "문의" });
    const ends = [{ type_id: type.id, label: "묶음", cardinality: "many" }, {
      type_id: type.id,
      label: "구성",
      cardinality: "many",
    }];
    const def = await createEntityRelationDefinition(d, requestActor(a.actor), { ends });
    const values = [];
    for (const title of ["원본", "상대1", "상대2"]) {
      values.push(
        await createEntity(entities, requestActor(a.actor), {
          entity_type_id: type.id,
          schema_version: 1,
          source: "app",
          identity_version: 1,
          properties: { prop_1: title },
        }),
      );
    }
    await asUser(sql, a.actor.userId, async (tx) => {
      for (const value of values.slice(1)) {
        await tx`insert into app.entity_relation_links(owner_id,definition_id,left_entity_id,right_entity_id) values(${a.actor.userId},${def.id},${
          values[0].id
        },${value.id})`;
      }
    });
    const single = [{ ...ends[0], cardinality: "one" }, ends[1]];
    assertEquals(
      (await assertRejects(
        () => updateEntityRelationDefinition(d, requestActor(a.actor), def.id, { ends: single, expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(() =>
        updateEntityRelationDefinition(d, requestActor(a.actor), def.id, {
          ends: [{ ...ends[0], type_id: other.id }, ends[1]],
          expected_version: 1,
        }), AppError)).code,
      "invalid_input",
    );
    assertEquals(
      (await assertRejects(
        () => deleteEntityRelationDefinition(d, requestActor(a.actor), def.id, { expected_version: 1 }),
        AppError,
      )).code,
      "invalid_input",
    );
    await assertRejects(() =>
      asUser(
        sql,
        a.actor.userId,
        (tx) =>
          tx`update app.entity_relation_definitions set left_cardinality='one',version=version+1 where id=${def.id}`,
      )
    );
    assertEquals(
      (await updateEntityRelationDefinition(d, requestActor(a.actor), def.id, { archived: true, expected_version: 1 }))
        .archived,
      true,
    );
    assertEquals((await getEntityRelationDefinition(d, a.actor, def.id)).version, 2);
  } finally {
    await a.cleanup();
    await sql.end();
    await admin.end();
  }
});
