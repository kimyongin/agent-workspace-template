import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import {
  decodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { createTag, setTagConnections } from "../../functions/_shared/core/tags/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  restoreEntity,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import { createEntityType, updateEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { EntityProperties } from "../../functions/_shared/contracts/entity.ts";

dbTest(
  "Typed entity workspace DB: scalar validation, current schema, replay, immutable restoration and metadata display",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct, { max: 4 });
    const owner = await businessWorkspaceFixture(admin, sql), other = await businessWorkspaceFixture(admin, sql);
    const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const first = await createEntityType(types, requestActor(owner.manager), { label: "재료", icon_id: "leaf" });
      const second = await createEntityType(types, requestActor(owner.manager), { label: "상품", icon_id: "package" });
      await owner.grantKind(owner.manager, first.id, "write");
      await owner.grantKind(owner.manager, second.id, "write");
      const definition = initialEntityDefinition("이름", { id: first.id, title: first.label, icon: first.icon_id });
      Object.assign(definition.schema.properties, {
        prop_3: { "x-order": 30, type: ["integer", "null"], title: "개수", default: 7 },
        prop_4: { "x-order": 40, type: ["number", "null"], title: "무게" },
        prop_5: { "x-order": 50, type: ["string", "null"], format: "date", title: "날짜" },
        prop_6: { "x-order": 60, type: ["boolean", "null"], title: "검사" },
        prop_7: {
          "x-order": 70,
          type: ["string", "null"],
          oneOf: [{ const: "a" }, { const: "b" }, { const: null }],
          title: "선택",
        },
      });
      const secondDefinition = initialEntityDefinition("상품명", {
        id: second.id,
        title: second.label,
        icon: second.icon_id,
      });
      secondDefinition.schema.properties.prop_3 = {
        "x-order": 30,
        type: "string",
        format: "date",
        default: "2024-02-29",
      };
      // Explicit fixture definition, not a product publishing shortcut.
      await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${owner.workspaceId},true)`;
        await tx`select id from app.entity_types where workspace_id=${owner.workspaceId} and id=${first.id} for update`;
        await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${owner.workspaceId},${
          tx.json({ ...definition.schema, "x-type-id": first.id, "x-version": 2 })
        })`;
        await tx`update app.entity_types set schema_version=2,next_property_number=8 where workspace_id=${owner.workspaceId} and id=${first.id}`;
        await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${owner.workspaceId},${
          tx.json({ ...secondDefinition.schema, "x-type-id": second.id, "x-version": 2 })
        })`;
        await tx`update app.entity_types set schema_version=2,next_property_number=4 where workspace_id=${owner.workspaceId} and id=${second.id}`;
      });
      const input = {
        entity_type_id: first.id,
        schema_version: 2,
        properties: {
          prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "000/한글%"),
          prop_1: "재료",
          prop_4: 0,
          prop_5: "2024-02-29",
          prop_6: false,
          prop_7: null,
        },
      };
      const intent = requestActor(owner.manager);
      const saved = await createEntity(entities, intent, input);
      assertEquals(await createEntity(entities, intent, input), saved);
      assertEquals(saved.properties, { ...input.properties, prop_3: 7 });
      assertEquals(saved.title, "재료");
      const summary =
        (await listEntities(entities, owner.manager, { entity_type_id: first.id, limit: 20, sort: "updated_at" }))
          .items[0];
      assertEquals(summary.title, "재료");
      assertEquals("display_properties" in summary, false);
      assertEquals("properties" in summary, false);
      assertEquals(
        (await assertRejects(() => getEntity(entities, other.manager, saved.id), AppError)).code,
        "not_found",
      );
      const invalidPatches: EntityProperties[] = [
        { prop_1: "" },
        { prop_3: 1.5 },
        { prop_3: Number.MAX_SAFE_INTEGER + 1 },
        { prop_4: 0.0000001 },
        { prop_5: "2023-02-29" },
        { prop_7: "unknown" },
        { prop_100: 1 },
      ];
      for (const patch of invalidPatches) {
        const error = await assertRejects(() =>
          updateEntity(entities, requestActor(owner.manager), saved.id, {
            expected_version: 1,
            schema_version: 2,
            properties: patch,
          }), AppError);
        assertEquals(error.code, "invalid_input");
        assertEquals(error.fields?.[0].path.startsWith("properties."), true);
      }
      const changed = await updateEntity(entities, requestActor(owner.manager), saved.id, {
        expected_version: 1,
        schema_version: 2,
        properties: { prop_3: null },
      });
      assertEquals(changed.properties, { ...input.properties, prop_3: null });
      await updateEntityType(types, requestActor(owner.manager), first.id, {
        expected_schema_version: 2,
        label: "材料",
        icon_id: "star",
      });
      input.schema_version = 3;
      const renamed = await getEntity(entities, owner.manager, saved.id);
      assertEquals([renamed.type.label, renamed.type.icon_id, renamed.schema_version, renamed.version], [
        "材料",
        "star",
        2,
        changed.version,
      ]);
      await deleteEntity(entities, requestActor(owner.manager), saved.id, changed.version);
      const deleted = await getEntity(entities, owner.manager, saved.id);
      assertEquals(
        (await assertRejects(
          () =>
            restoreEntity(entities, requestActor(owner.manager), saved.id.replace(first.id, second.id), {
              schema_version: 2,
              expected_version: deleted.version,
            }),
          AppError,
        )).code,
        "not_found",
      );
      // Another type computes another canonical target; it cannot restore this deleted row.
      assertEquals((await getEntity(entities, owner.manager, saved.id)).deleted_at, deleted.deleted_at);
      const restored = await restoreEntity(entities, requestActor(owner.manager), saved.id, {
        schema_version: input.schema_version,
        expected_version: deleted.version,
      });
      assertEquals(restored.properties, changed.properties);
      assertEquals(restored.entity_type_id, first.id);
      const [count] =
        await admin`select count(*)::int n from app.records where workspace_id=${owner.workspaceId} and change_metadata->>'target_id'=${saved.id}`;
      assertEquals(count.n, 4);
      await admin`update app.entity_types set schema_write_locked=true where workspace_id=${owner.workspaceId} and id=${first.id}`;
      assertEquals(
        (await assertRejects(() =>
          updateEntity(entities, requestActor(owner.manager), saved.id, {
            schema_version: 3,
            expected_version: restored.version,
            properties: { prop_1: "blocked" },
          }), AppError)).code,
        "schema_migration_in_progress",
      );
      assertEquals((await getEntity(entities, owner.manager, saved.id)).properties, restored.properties);
      const independent = await createEntity(entities, requestActor(owner.manager), {
        entity_type_id: second.id,
        schema_version: 2,
        properties: { prop_1: "상품", prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "independent") },
      });
      assertEquals(independent.properties.prop_3, "2024-02-29");
      await admin`update app.entity_types set schema_write_locked=false where workspace_id=${owner.workspaceId} and id=${first.id}`;
      await updateEntityType(types, requestActor(owner.manager), first.id, {
        expected_schema_version: 3,
        archived: true,
      });
      input.schema_version = 4;
      const edit = await updateEntity(entities, requestActor(owner.manager), saved.id, {
        schema_version: 4,
        expected_version: restored.version,
        properties: { prop_1: "보관 편집" },
      });
      await deleteEntity(entities, requestActor(owner.manager), saved.id, edit.version);
      const archived = await getEntity(entities, owner.manager, saved.id);
      assertEquals(
        (await assertRejects(
          () =>
            restoreEntity(entities, requestActor(owner.manager), saved.id, {
              schema_version: input.schema_version,
              expected_version: archived.version,
            }),
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
  "Typed entity workspace DB: schema publication lock serializes validation and preserves unrelated type writes",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 4 }),
      owner = await businessWorkspaceFixture(admin, sql);
    const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
    try {
      const a = await createEntityType(types, requestActor(owner.manager), { label: "재료" });
      const b = await createEntityType(types, requestActor(owner.manager), { label: "상품" });
      await owner.grantKind(owner.manager, a.id, "write");
      await owner.grantKind(owner.manager, b.id, "write");
      const original = await createEntity(entities, requestActor(owner.manager), {
        entity_type_id: a.id,
        schema_version: 1,
        properties: { prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "stored"), prop_1: "existing" },
      });
      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => locked = resolve),
        gate = new Promise<void>((resolve) => release = resolve);
      const definition = initialEntityDefinition("이름", { id: a.id, title: a.label, icon: a.icon_id });
      definition.schema.properties.prop_3 = { "x-order": 30, type: "string", default: "new" };
      const publication = admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${owner.workspaceId},true)`;
        await tx`select id from app.entity_types where workspace_id=${owner.workspaceId} and id=${a.id} for update`;
        locked();
        await gate;
        await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${owner.workspaceId},${
          tx.json({ ...definition.schema, "x-type-id": a.id, "x-version": 2 })
        })`;
        await tx`update app.entity_types set schema_version=2 where workspace_id=${owner.workspaceId} and id=${a.id}`;
      });
      await ready;
      const pending = createEntity(entities, requestActor(owner.manager), {
        entity_type_id: a.id,
        schema_version: 1,
        properties: { prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "racing"), prop_1: "old form" },
      });
      try {
        const independent = await createEntity(entities, requestActor(owner.manager), {
          entity_type_id: b.id,
          schema_version: 1,
          properties: { prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "independent"), prop_1: "상품" },
        });
        assertEquals(independent.entity_type_id, b.id);
      } finally {
        release();
      }
      await publication;
      assertEquals((await assertRejects(() => pending, AppError)).code, "schema_changed");
      assertEquals(
        (await listEntities(entities, owner.manager, { entity_type_id: a.id, limit: 20, sort: "updated_at" })).items
          .map(
            (row) => decodeIdentifierReference(row.id).raw,
          ),
        ["stored"],
      );
      const oldRead = await getEntity(entities, owner.manager, original.id);
      assertEquals(oldRead.properties, {
        prop_1: "existing",
        prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "stored"),
      });
      assertEquals([oldRead.schema_version, oldRead.current_schema_version], [1, 2]);
      const tags = { uow: new SqlTagUnitOfWork(sql) };
      const tag = await createTag(tags, requestActor(owner.manager), { scope: "entity", name: "unrelated" });
      const connection = await setTagConnections(tags, requestActor(owner.manager), {
        target_kind: "entity",
        target_id: original.id,
        expected_version: 1,
        tag_ids: [tag.id],
      });
      const unrelated = await getEntity(entities, owner.manager, original.id);
      assertEquals(unrelated.properties, {
        prop_1: "existing",
        prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "stored"),
      });
      assertEquals(unrelated.tag_ids, [tag.id]);
      assertEquals(unrelated.version, connection.version);
      await deleteEntity(entities, requestActor(owner.manager), original.id, unrelated.version);
      const removed = await getEntity(entities, owner.manager, original.id);
      const restored = await restoreEntity(entities, requestActor(owner.manager), original.id, {
        schema_version: 2,
        expected_version: removed.version,
      });
      assertEquals(restored.properties, {
        prop_1: "existing",
        prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "stored"),
      });
      assertEquals(restored.tag_ids, [tag.id]);
      const current = await createEntity(entities, requestActor(owner.manager), {
        entity_type_id: a.id,
        schema_version: 2,
        properties: { prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "racing"), prop_1: "reviewed" },
      });
      assertEquals(current.properties, {
        prop_1: "reviewed",
        prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "racing"),
        prop_3: "new",
      });
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest("Typed entity workspace DB: the 64 KiB properties limit matches canonical SQL bytes", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct), owner = await businessWorkspaceFixture(admin, sql);
  const entities = { uow: new SqlEntityUnitOfWork(sql) }, types = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    const type = await createEntityType(types, requestActor(owner.manager), { label: "한도 자료" });
    await owner.grantKind(owner.manager, type.id, "write");
    const definition = initialEntityDefinition("이름", { id: type.id, title: type.label, icon: type.icon_id });
    const properties: EntityProperties = {
      prop_1: "size",
      prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "size"),
    };
    for (let n = 3; n <= 18; n++) {
      const key = `prop_${n}`;
      definition.schema.properties[key] = { "x-order": n * 10, type: "string", maxLength: 4096 };
      properties[key] = "x".repeat(4096);
    }
    const [size] = await admin`select octet_length(${admin.json(properties)}::jsonb::text)::int bytes`;
    properties.prop_18 = "x".repeat(4096 - (Number(size.bytes) - 65536));
    const [canonical] = await admin`select octet_length(${admin.json(properties)}::jsonb::text)::int bytes`;
    assertEquals(canonical.bytes, 65536);
    await admin.begin(async (tx) => {
      await tx`select set_config('request.workspace_id',${owner.workspaceId},true)`;
      await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${owner.workspaceId},${
        tx.json({ ...definition.schema, "x-type-id": type.id, "x-version": 2 })
      })`;
      await tx`update app.entity_types set schema_version=2,next_property_number=19 where workspace_id=${owner.workspaceId} and id=${type.id}`;
    });
    const created = await createEntity(entities, requestActor(owner.manager), {
      entity_type_id: type.id,
      schema_version: 2,
      properties,
    });
    assertEquals(created.properties, properties);
    const error = await assertRejects(
      () =>
        updateEntity(entities, requestActor(owner.manager), created.id, {
          schema_version: 2,
          expected_version: 1,
          properties: { prop_18: String(properties.prop_18) + "x" },
        }),
      AppError,
    );
    assertEquals(error.fields?.[0].path, "properties");
    assertEquals((await getEntity(entities, owner.manager, created.id)).version, 1);
  } finally {
    await owner.cleanup();
    await sql.end();
    await admin.end();
  }
});
