import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import {
  createEntityType,
  getEntitySchema,
  getEntityType,
  listEntitySchemaVersions,
  listEntityTypes,
  updateEntityType,
} from "../../functions/_shared/core/entity-types/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
dbTest("type foundation: explicit creation, owner isolation, immutable versions and metadata retries", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
  const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
  const d = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    assertEquals((await listEntityTypes(d, a.actor)).items, []);
    const actor = requestActor(a.actor);
    const first = await createEntityType(d, actor, { label: "재료", icon_id: "leaf" });
    assertEquals(await createEntityType(d, actor, { label: "재료", icon_id: "leaf" }), first);
    const second = await createEntityType(d, requestActor(a.actor), { label: "상품" });
    const definition = await getEntitySchema(d, a.actor, { type_id: first.id });
    assertEquals(definition.schema.required, ["prop_1"]);
    assertEquals(definition.display.representative, "prop_1");
    assertEquals((await getEntitySchema(d, a.actor, { type_id: second.id })).schema_version, 1);
    assertEquals((await listEntityTypes(d, b.actor)).items, []);
    assertEquals((await assertRejects(() => getEntityType(d, b.actor, first.id), AppError)).code, "not_found");
    assertEquals(
      (await assertRejects(() => getEntitySchema(d, b.actor, { type_id: first.id }), AppError)).code,
      "not_found",
    );
    const mutation = {
      expected_type_version: first.version,
      expected_schema_version: first.schema_version,
      label: "材料",
      icon_id: "star",
      archived: true,
    };
    const updater = requestActor(a.actor);
    const changed = await updateEntityType(d, updater, first.id, mutation);
    assertEquals(await updateEntityType(d, updater, first.id, mutation), changed);
    assertEquals(changed.version, 2);
    assertEquals(changed.schema_version, 1);
    assertEquals((await listEntityTypes(d, a.actor)).items.map((row) => row.id), [second.id]);
    assertEquals(
      (await getEntitySchema(d, a.actor, { type_id: first.id, schema_version: 1 })).schema,
      definition.schema,
    );
    assertEquals((await listEntitySchemaVersions(d, a.actor, { type_id: first.id })).items.length, 1);
    const races = await Promise.allSettled(
      ["복원 A", "복원 B"].map((label) =>
        updateEntityType(d, requestActor(a.actor), first.id, {
          expected_type_version: 2,
          expected_schema_version: 1,
          label,
          archived: false,
        })
      ),
    );
    assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
    assertEquals((await getEntityType(d, a.actor, second.id)).version, 1);
    await assertRejects(() =>
      asUser(sql, a.actor.userId, async (tx) => {
        await tx`update app.entity_schema_versions set schema='{}'::jsonb where type_id=${first.id}`;
      })
    );
    await assertRejects(
      () => createEntityType(d, requestActor(a.actor), { label: "잘못된 아이콘", icon_id: "unknown" }),
      AppError,
    );
    await admin`update app.entity_types set icon_id='retired-icon' where id=${second.id}`;
    assertEquals((await getEntityType(d, a.actor, second.id)).icon_id, "box");
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});
