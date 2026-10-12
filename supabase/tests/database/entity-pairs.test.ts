import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityPairUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-pair-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType, updateEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { changeEntityPair, listEntityLinks } from "../../functions/_shared/core/entity-pairs/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
dbTest(
  "entity pairs: owner/RLS/canonical reverse race, lifecycle, Unicode rekey rollback, gates and bounded pages",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 5 }),
      a = await fixtureOwner(admin),
      b = await fixtureOwner(admin);
    const entities = { uow: new SqlEntityUnitOfWork(sql) },
      pairs = { uow: new SqlEntityPairUnitOfWork(sql) },
      types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const t1 = await createEntityType(types, requestActor(a.actor), { label: "재료", icon_id: "leaf" });
      const t2 = await createEntityType(types, requestActor(a.actor), { label: "상품", icon_id: "box" });
      const create = async (type: string, external_id: string) =>
        await createEntity(entities, requestActor(a.actor), {
          entity_type_id: type,
          schema_version: 1,
          source: "app",
          external_id,
          properties: { prop_1: external_id },
        });
      const x = await create(t1.id, "\uE000"), y = await create(t2.id, "😀"), z = await create(t1.id, "a/?#%한글");
      const key = requestActor(a.actor), input = { other_id: y.id, expected_version: 1, expected_other_version: 1 };
      const raced = await Promise.all([
        changeEntityPair(pairs, key, x.id, input, true),
        changeEntityPair(pairs, { ...key, request: { key: key.request!.key } }, y.id, {
          other_id: x.id,
          expected_version: 1,
          expected_other_version: 1,
        }, true),
      ]);
      assertEquals(raced[0], raced[1]);
      assertEquals(raced[0].pair, { entity_id: x.id, other_id: y.id });
      assertEquals((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items.map((e) => e.id), [x.id]);
      assertEquals(
        (await assertRejects(() => listEntityLinks(pairs, b.actor, x.id, { limit: 20 }), AppError)).code,
        "not_found",
      );
      assertEquals((await asUser(sql, b.actor.userId, (tx) => tx`select * from app.entity_pairs`)).length, 0);
      await assertRejects(() =>
        asUser(
          sql,
          a.actor.userId,
          (tx) =>
            tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${a.actor.userId},${x.id},${x.id})`,
        )
      );
      const foreignType = await createEntityType(types, requestActor(b.actor), { label: "외부" });
      const foreign = await createEntity(entities, requestActor(b.actor), {
        entity_type_id: foreignType.id,
        schema_version: 1,
        source: "app",
        external_id: "foreign",
        properties: { prop_1: "외부" },
      });
      await assertRejects(() =>
        changeEntityPair(pairs, requestActor(a.actor), x.id, {
          other_id: foreign.id,
          expected_version: 2,
          expected_other_version: 1,
        }, true)
      );
      const records =
        await admin`select entity_ids,entity_context from app.records where owner_id=${a.actor.userId} and entity_ids @> array[${x.id},${y.id}]::text[]`;
      assertEquals(records.length, 1);
      assertEquals(records[0].entity_context.length, 2);
      assertEquals(
        (await changeEntityPair(pairs, requestActor(a.actor), y.id, {
          other_id: x.id,
          expected_version: 2,
          expected_other_version: 2,
        }, true)).changed,
        false,
      );
      const second = await changeEntityPair(pairs, requestActor(a.actor), x.id, {
        other_id: z.id,
        expected_version: 2,
        expected_other_version: 1,
      }, true);
      assert(second.changed);
      const page = await listEntityLinks(pairs, a.actor, x.id, { limit: 1 });
      assertEquals(page.items[0].id, z.id);
      assert(page.next_cursor);
      assertEquals(
        (await listEntityLinks(pairs, a.actor, x.id, { limit: 1, cursor: page.next_cursor! })).items[0].id,
        y.id,
      );
      await assertRejects(() => listEntityLinks(pairs, a.actor, y.id, { limit: 1, cursor: page.next_cursor! }));
      const candidates = await listEntities(entities, a.actor, { limit: 20, sort: "title", link_candidate_for: x.id });
      assertEquals(candidates.items, []);
      // Foundation gate fixture; actual applying-job integration belongs to #348/#351.
      await admin`update app.entity_types set schema_write_locked=true where owner_id=${a.actor.userId} and id=${t2.id}`;
      assertEquals(
        (await assertRejects(() =>
          changeEntityPair(pairs, requestActor(a.actor), x.id, {
            other_id: y.id,
            expected_version: 3,
            expected_other_version: 2,
          }, false), AppError)).code,
        "schema_migration_in_progress",
      );
      await admin`update app.entity_types set schema_write_locked=false where owner_id=${a.actor.userId} and id=${t2.id}`;
      const renamed = await updateEntity(entities, requestActor(a.actor), x.id, {
        schema_version: 1,
        expected_version: 3,
        external_id: "zz/?#%😀",
      });
      const renamedLinks = await listEntityLinks(pairs, a.actor, renamed.id, { limit: 20 });
      assertEquals(
        renamedLinks.items.map((e) => e.id),
        [z.id, y.id],
      );
      assertEquals((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items[0].id, renamed.id);
      const before = await getEntity(entities, a.actor, renamed.id);
      await assertRejects(() =>
        updateEntity(entities, requestActor(a.actor), renamed.id, {
          schema_version: 1,
          expected_version: before.version,
          external_id: y.external_id,
        })
      );
      assertEquals((await getEntity(entities, a.actor, renamed.id)).version, before.version);
      await deleteEntity(entities, requestActor(a.actor), renamed.id, before.version);
      assert((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items[0].deleted_at);
      const deleted = await getEntity(entities, a.actor, renamed.id),
        latestY = await getEntity(entities, a.actor, y.id);
      await changeEntityPair(pairs, requestActor(a.actor), y.id, {
        other_id: renamed.id,
        expected_version: latestY.version,
        expected_other_version: deleted.version,
      }, false);
      assertEquals((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items, []);
      const latestZ = await getEntity(entities, a.actor, z.id),
        latestDeleted = await getEntity(entities, a.actor, renamed.id);
      const archived = await updateEntityType(types, requestActor(a.actor), t1.id, {
        expected_type_version: t1.version,
        expected_schema_version: 1,
        archived: true,
      });
      await changeEntityPair(pairs, requestActor(a.actor), z.id, {
        other_id: renamed.id,
        expected_version: latestZ.version,
        expected_other_version: latestDeleted.version,
      }, false);
      assertEquals(archived.archived, true);
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
