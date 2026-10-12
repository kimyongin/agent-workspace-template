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
import { TEXT_LIMITS } from "../../functions/_shared/contracts/common.ts";
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
      await assertRejects(() =>
        asUser(
          sql,
          a.actor.userId,
          (tx) =>
            tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${a.actor.userId},${foreign.id},${x.id})`,
        )
      );
      const records =
        await admin`select id,body,entity_ids,entity_context from app.records where owner_id=${a.actor.userId} and entity_ids @> array[${x.id},${y.id}]::text[]`;
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
      await changeEntityPair(pairs, requestActor(a.actor), y.id, {
        other_id: z.id,
        expected_version: 2,
        expected_other_version: 2,
      }, true);
      assertEquals((await listEntityLinks(pairs, a.actor, z.id, { limit: 20 })).items.length, 2); // cycle allowed
      const w = await create(t1.id, "race-left"), v = await create(t1.id, "race-right");
      const independent = await Promise.allSettled([
        changeEntityPair(pairs, requestActor(a.actor), w.id, {
          other_id: v.id,
          expected_version: 1,
          expected_other_version: 1,
        }, true),
        changeEntityPair(pairs, requestActor(a.actor), v.id, {
          other_id: w.id,
          expected_version: 1,
          expected_other_version: 1,
        }, true),
      ]);
      assertEquals(independent.filter((result) => result.status === "fulfilled").length, 1);
      assertEquals((await listEntityLinks(pairs, a.actor, w.id, { limit: 20 })).items.length, 1);
      const independentEvents =
        await admin`select id from app.records where owner_id=${a.actor.userId} and entity_ids @> array[${w.id},${v.id}]::text[]`;
      assertEquals(independentEvents.length, 1);
      const p = await create(t1.id, "concurrent-origin"), q = await create(t2.id, "concurrent-peer");
      await changeEntityPair(pairs, requestActor(a.actor), p.id, {
        other_id: q.id,
        expected_version: 1,
        expected_other_version: 1,
      }, true);
      const rekeyRace = await Promise.allSettled([
        updateEntity(entities, requestActor(a.actor), p.id, {
          schema_version: 1,
          expected_version: 2,
          external_id: "rekey-race-next",
        }),
        changeEntityPair(pairs, requestActor(a.actor), q.id, {
          other_id: p.id,
          expected_version: 2,
          expected_other_version: 2,
        }, false),
      ]);
      assertEquals(rekeyRace.filter((result) => result.status === "fulfilled").length, 1);
      for (const result of rekeyRace) {
        if (result.status === "rejected") assert((result.reason as AppError).code !== "unavailable");
      }
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
      assertEquals(
        (await changeEntityPair(pairs, requestActor(a.actor), w.id, {
          other_id: v.id,
          expected_version: 2,
          expected_other_version: 2,
        }, true)).changed,
        false,
      );
      assertEquals(
        (await assertRejects(() =>
          updateEntity(entities, requestActor(a.actor), x.id, {
            schema_version: 1,
            expected_version: 3,
            external_id: "blocked-rekey",
          }), AppError)).code,
        "schema_migration_in_progress",
      );
      await admin`update app.entity_types set schema_write_locked=false where owner_id=${a.actor.userId} and id=${t2.id}`;
      const renamed = await updateEntity(entities, requestActor(a.actor), x.id, {
        schema_version: 1,
        expected_version: 3,
        external_id: "\u{10FFFF}/?#%😀",
      });
      const renamedLinks = await listEntityLinks(pairs, a.actor, renamed.id, { limit: 20 });
      assertEquals(
        renamedLinks.items.map((e) => e.id),
        [z.id, y.id],
      );
      assertEquals((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items[0].id, renamed.id);
      const [canonical] =
        await admin`select entity_id,other_id from app.entity_pairs where owner_id=${a.actor.userId} and (entity_id=${y.id} or other_id=${y.id}) and (entity_id=${renamed.id} or other_id=${renamed.id})`;
      assertEquals({ entity_id: canonical.entity_id, other_id: canonical.other_id }, {
        entity_id: y.id,
        other_id: renamed.id,
      });
      const [history] = await admin`select body from app.records where owner_id=${a.actor.userId} and id=${
        records[0].id
      }`;
      assertEquals(history.body, records[0].body);
      const before = await getEntity(entities, a.actor, renamed.id);
      await assertRejects(() =>
        updateEntity(entities, requestActor(a.actor), renamed.id, {
          schema_version: 1,
          expected_version: before.version,
          external_id: y.external_id,
        })
      );
      assertEquals((await getEntity(entities, a.actor, renamed.id)).version, before.version);
      await assertRejects(() =>
        updateEntity(entities, requestActor(a.actor), renamed.id, {
          schema_version: 1,
          expected_version: before.version,
          external_id: "rollback-only",
          change_note: "x".repeat(TEXT_LIMITS.body.max + 1),
        })
      );
      assertEquals((await getEntity(entities, a.actor, renamed.id)).version, before.version);
      assertEquals(
        (await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items.some((item) => item.id === renamed.id),
        true,
      );
      await assertRejects(() => getEntity(entities, a.actor, "app:rollback-only"));
      await deleteEntity(entities, requestActor(a.actor), renamed.id, before.version);
      assert((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items[0].deleted_at);
      const yBeforeDelete = await getEntity(entities, a.actor, y.id);
      await deleteEntity(entities, requestActor(a.actor), y.id, yBeforeDelete.version);
      assert(
        (await listEntityLinks(pairs, a.actor, renamed.id, { limit: 20 })).items.find((item) => item.id === y.id)!
          .deleted_at,
      );
      const xDeleted = await getEntity(entities, a.actor, renamed.id),
        yDeleted = await getEntity(entities, a.actor, y.id);
      await createEntity(entities, requestActor(a.actor), {
        entity_type_id: t2.id,
        schema_version: 1,
        source: y.source,
        external_id: y.external_id,
        expected_version: yDeleted.version,
        properties: y.properties,
      });
      const restored = await createEntity(entities, requestActor(a.actor), {
        entity_type_id: t1.id,
        schema_version: 1,
        source: renamed.source,
        external_id: renamed.external_id,
        expected_version: xDeleted.version,
        properties: renamed.properties,
      });
      assertEquals(
        (await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items.some((item) =>
          item.id === restored.id && item.deleted_at === null
        ),
        true,
      );
      await deleteEntity(entities, requestActor(a.actor), restored.id, restored.version);
      const deleted = await getEntity(entities, a.actor, renamed.id),
        latestY = await getEntity(entities, a.actor, y.id);
      await changeEntityPair(pairs, requestActor(a.actor), y.id, {
        other_id: renamed.id,
        expected_version: latestY.version,
        expected_other_version: deleted.version,
      }, false);
      assertEquals((await listEntityLinks(pairs, a.actor, y.id, { limit: 20 })).items.map((item) => item.id), [z.id]);
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
dbTest("entity pair cap: 100 preserved links, next-link rejection and no-op at cap", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct), owner = await fixtureOwner(admin);
  const entities = { uow: new SqlEntityUnitOfWork(sql) },
    pairs = { uow: new SqlEntityPairUnitOfWork(sql) },
    types = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(owner.actor), { label: "연결 한도" });
    await admin`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties)
    select ${owner.actor.userId}::uuid,'app:cap-'||lpad(n::text,3,'0'),'app','cap-'||lpad(n::text,3,'0'),${type.id}::uuid,1,jsonb_build_object('prop_1','자료 '||n)
    from generate_series(0,101) n`;
    await admin`insert into app.entity_pairs(owner_id,entity_id,other_id)
    select ${owner.actor.userId}::uuid,'app:cap-000','app:cap-'||lpad(n::text,3,'0') from generate_series(1,100) n`;
    assertEquals((await listEntityLinks(pairs, owner.actor, "app:cap-000", { limit: 100 })).items.length, 100);
    assertEquals(
      (await changeEntityPair(pairs, requestActor(owner.actor), "app:cap-000", {
        other_id: "app:cap-001",
        expected_version: 1,
        expected_other_version: 1,
      }, true)).changed,
      false,
    );
    const error = await assertRejects(
      () =>
        changeEntityPair(pairs, requestActor(owner.actor), "app:cap-000", {
          other_id: "app:cap-101",
          expected_version: 1,
          expected_other_version: 1,
        }, true),
      AppError,
    );
    assertEquals(error.code, "invalid_input");
    assertEquals((await getEntity(entities, owner.actor, "app:cap-000")).version, 1);
    assertEquals(
      (await admin`select count(*)::int as n from app.records where owner_id=${owner.actor.userId}`)[0].n,
      0,
    );
  } finally {
    await owner.cleanup();
    await sql.end();
    await admin.end();
  }
});
