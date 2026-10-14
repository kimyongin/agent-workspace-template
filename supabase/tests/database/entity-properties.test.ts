import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { createEntityType, updateEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { EntityProperties } from "../../functions/_shared/contracts/entity.ts";

dbTest(
  "Typed entity owner DB: scalar validation, current schema, replay, immutable restoration and metadata display",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 4 });
    const owner = await fixtureOwner(admin), other = await fixtureOwner(admin);
    const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const first = await createEntityType(types, requestActor(owner.actor), { label: "재료", icon_id: "leaf" });
      const second = await createEntityType(types, requestActor(owner.actor), { label: "상품", icon_id: "package" });
      const definition = initialEntityDefinition("이름");
      Object.assign(definition.schema.properties, {
        prop_2: { type: ["integer", "null"], title: "개수", default: 7 },
        prop_3: { type: ["number", "null"], title: "무게" },
        prop_4: { type: ["string", "null"], format: "date", title: "날짜" },
        prop_5: { type: ["boolean", "null"], title: "검사" },
        prop_6: { type: ["string", "null"], enum: ["a", "b", null], title: "선택" },
      });
      definition.display.order = ["prop_1", "prop_2", "prop_3", "prop_4", "prop_5", "prop_6"];
      const secondDefinition = initialEntityDefinition("상품명");
      secondDefinition.schema.properties.prop_2 = { type: "string", format: "date", default: "2024-02-29" };
      secondDefinition.display.order.push("prop_2");
      // Explicit fixture definition, not a product publishing shortcut.
      await admin.begin(async (tx) => {
        await tx`select id from app.entity_types where id=${first.id} for update`;
        await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${owner.actor.userId},${first.id},2,${
          tx.json(definition.schema)
        },${tx.json(definition.display)})`;
        await tx`update app.entity_types set schema_version=2,next_property_number=7 where id=${first.id}`;
        await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${owner.actor.userId},${second.id},2,${
          tx.json(secondDefinition.schema)
        },${tx.json(secondDefinition.display)})`;
        await tx`update app.entity_types set schema_version=2,next_property_number=3 where id=${second.id}`;
      });
      const input = {
        entity_type_id: first.id,
        schema_version: 2,
        external_id: "000/한글%",
        properties: { prop_1: "재료", prop_3: 0, prop_4: "2024-02-29", prop_5: false, prop_6: null },
      };
      const intent = requestActor(owner.actor);
      const saved = await createEntity(entities, intent, input);
      assertEquals(await createEntity(entities, intent, input), saved);
      assertEquals(saved.properties, { ...input.properties, prop_2: 7 });
      assertEquals(saved.title, "재료");
      const summary =
        (await listEntities(entities, owner.actor, { entity_type_id: first.id, limit: 20, sort: "updated_at" }))
          .items[0];
      assertEquals(summary.display_properties, { prop_1: "재료" });
      assertEquals("properties" in summary, false);
      assertEquals((await assertRejects(() => getEntity(entities, other.actor, saved.id), AppError)).code, "not_found");
      const invalidPatches: EntityProperties[] = [
        { prop_1: "  " },
        { prop_2: 1.5 },
        { prop_2: Number.MAX_SAFE_INTEGER + 1 },
        { prop_3: 0.0000001 },
        { prop_4: "2023-02-29" },
        { prop_6: "unknown" },
        { prop_99: 1 },
      ];
      for (const patch of invalidPatches) {
        const error = await assertRejects(() =>
          updateEntity(entities, requestActor(owner.actor), saved.id, {
            expected_version: 1,
            schema_version: 2,
            properties: patch,
          }), AppError);
        assertEquals(error.code, "invalid_input");
        assertEquals(error.fields?.[0].path.startsWith("properties."), true);
      }
      const changed = await updateEntity(entities, requestActor(owner.actor), saved.id, {
        expected_version: 1,
        schema_version: 2,
        properties: { prop_2: null },
      });
      assertEquals(changed.properties, { ...input.properties, prop_2: null });
      await updateEntityType(types, requestActor(owner.actor), first.id, {
        expected_type_version: first.version,
        label: "材料",
        icon_id: "star",
      });
      const renamed = await getEntity(entities, owner.actor, saved.id);
      assertEquals([renamed.type.label, renamed.type.icon_id, renamed.schema_version, renamed.version], [
        "材料",
        "star",
        2,
        changed.version,
      ]);
      await deleteEntity(entities, requestActor(owner.actor), saved.id, changed.version);
      const deleted = await getEntity(entities, owner.actor, saved.id);
      assertEquals(
        (await assertRejects(() =>
          createEntity(entities, requestActor(owner.actor), {
            ...input,
            entity_type_id: second.id,
            schema_version: 2,
            expected_version: deleted.version,
          }), AppError)).code,
        "conflict",
      );
      // Another type computes another canonical target; it cannot restore this deleted row.
      assertEquals((await getEntity(entities, owner.actor, saved.id)).deleted_at, deleted.deleted_at);
      const restored = await createEntity(entities, requestActor(owner.actor), {
        ...input,
        properties: {},
        expected_version: deleted.version,
      });
      assertEquals(restored.properties, changed.properties);
      assertEquals(restored.entity_type_id, first.id);
      const [count] =
        await admin`select count(*)::int n from app.records where owner_id=${owner.actor.userId} and change_metadata->>'target_id'=${saved.id}`;
      assertEquals(count.n, 4);
      await admin`update app.entity_types set schema_write_locked=true where id=${first.id}`;
      assertEquals(
        (await assertRejects(() =>
          updateEntity(entities, requestActor(owner.actor), saved.id, {
            schema_version: 2,
            expected_version: restored.version,
            properties: { prop_1: "blocked" },
          }), AppError)).code,
        "schema_migration_in_progress",
      );
      assertEquals((await getEntity(entities, owner.actor, saved.id)).properties, restored.properties);
      const independent = await createEntity(entities, requestActor(owner.actor), {
        entity_type_id: second.id,
        schema_version: 2,
        properties: { prop_1: "상품" },
        external_id: "independent",
      });
      assertEquals(independent.properties.prop_2, "2024-02-29");
      await admin`update app.entity_types set schema_write_locked=false,archived=true where id=${first.id}`;
      const edit = await updateEntity(entities, requestActor(owner.actor), saved.id, {
        schema_version: 2,
        expected_version: restored.version,
        properties: { prop_1: "보관 편집" },
      });
      await deleteEntity(entities, requestActor(owner.actor), saved.id, edit.version);
      const archived = await getEntity(entities, owner.actor, saved.id);
      assertEquals(
        (await assertRejects(
          () => createEntity(entities, requestActor(owner.actor), { ...input, expected_version: archived.version }),
          AppError,
        )).code,
        "entity_type_archived",
      );
    } finally {
      await owner.cleanup();
      await other.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "Typed entity owner DB: schema publication lock serializes validation and preserves unrelated type writes",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 4 }), owner = await fixtureOwner(admin);
    const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const a = await createEntityType(types, requestActor(owner.actor), { label: "재료" });
      const b = await createEntityType(types, requestActor(owner.actor), { label: "상품" });
      const original = await createEntity(entities, requestActor(owner.actor), {
        entity_type_id: a.id,
        schema_version: 1,
        external_id: "stored",
        properties: { prop_1: "existing" },
      });
      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => locked = resolve),
        gate = new Promise<void>((resolve) => release = resolve);
      const definition = initialEntityDefinition("이름");
      definition.schema.properties.prop_2 = { type: "string", default: "new" };
      definition.display.order.push("prop_2");
      const publication = admin.begin(async (tx) => {
        await tx`select id from app.entity_types where id=${a.id} for update`;
        locked();
        await gate;
        await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${owner.actor.userId},${a.id},2,${
          tx.json(definition.schema)
        },${tx.json(definition.display)})`;
        await tx`update app.entity_types set schema_version=2 where id=${a.id}`;
      });
      await ready;
      const pending = createEntity(entities, requestActor(owner.actor), {
        entity_type_id: a.id,
        schema_version: 1,
        external_id: "racing",
        properties: { prop_1: "old form" },
      });
      try {
        const independent = await createEntity(entities, requestActor(owner.actor), {
          entity_type_id: b.id,
          schema_version: 1,
          external_id: "independent",
          properties: { prop_1: "상품" },
        });
        assertEquals(independent.entity_type_id, b.id);
      } finally {
        release();
      }
      await publication;
      assertEquals((await assertRejects(() => pending, AppError)).code, "schema_changed");
      assertEquals(
        (await listEntities(entities, owner.actor, { entity_type_id: a.id, limit: 20, sort: "updated_at" })).items.map(
          (row) => row.external_id,
        ),
        ["stored"],
      );
      const oldRead = await getEntity(entities, owner.actor, original.id);
      assertEquals(oldRead.properties, { prop_1: "existing" });
      assertEquals([oldRead.schema_version, oldRead.current_schema_version], [1, 2]);
      const unrelated = await updateEntity(entities, requestActor(owner.actor), original.id, {
        schema_version: 2,
        expected_version: 1,
        tag_ids: [],
      });
      assertEquals(unrelated.properties, { prop_1: "existing" });
      await deleteEntity(entities, requestActor(owner.actor), original.id, unrelated.version);
      const removed = await getEntity(entities, owner.actor, original.id);
      const restored = await createEntity(entities, requestActor(owner.actor), {
        entity_type_id: a.id,
        schema_version: 2,
        external_id: "stored",
        properties: {},
        expected_version: removed.version,
      });
      assertEquals(restored.properties, { prop_1: "existing" });
      const current = await createEntity(entities, requestActor(owner.actor), {
        entity_type_id: a.id,
        schema_version: 2,
        external_id: "racing",
        properties: { prop_1: "reviewed" },
      });
      assertEquals(current.properties, { prop_1: "reviewed", prop_2: "new" });
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest("Typed entity owner DB: the 64 KiB properties limit matches canonical SQL bytes", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct), owner = await fixtureOwner(admin);
  const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(owner.actor), { label: "한도 자료" });
    const definition = initialEntityDefinition("이름");
    const properties: EntityProperties = { prop_1: "size" };
    for (let n = 2; n <= 17; n++) {
      const key = `prop_${n}`;
      definition.schema.properties[key] = { type: "string", maxLength: 4096 };
      definition.display.order.push(key);
      properties[key] = "x".repeat(4096);
    }
    const [size] = await admin`select octet_length(${admin.json(properties)}::jsonb::text)::int bytes`;
    properties.prop_17 = "x".repeat(4096 - (Number(size.bytes) - 65536));
    const [canonical] = await admin`select octet_length(${admin.json(properties)}::jsonb::text)::int bytes`;
    assertEquals(canonical.bytes, 65536);
    await admin.begin(async (tx) => {
      await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${owner.actor.userId},${type.id},2,${
        tx.json(definition.schema)
      },${tx.json(definition.display)})`;
      await tx`update app.entity_types set schema_version=2,next_property_number=18 where id=${type.id}`;
    });
    const created = await createEntity(entities, requestActor(owner.actor), {
      entity_type_id: type.id,
      schema_version: 2,
      external_id: "size",
      properties,
    });
    assertEquals(created.properties, properties);
    const error = await assertRejects(
      () =>
        updateEntity(entities, requestActor(owner.actor), created.id, {
          schema_version: 2,
          expected_version: 1,
          properties: { prop_17: String(properties.prop_17) + "x" },
        }),
      AppError,
    );
    assertEquals(error.fields?.[0].path, "properties");
    assertEquals((await getEntity(entities, owner.actor, created.id)).version, 1);
  } finally {
    await owner.cleanup();
    await sql.end();
    await admin.end();
  }
});
