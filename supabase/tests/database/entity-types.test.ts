import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
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
dbTest("type foundation: explicit creation, workspace isolation, immutable versions and metadata retries", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3 });
  const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
  const d = { uow: new SqlEntityTypeUnitOfWork(sql) };
  try {
    assertEquals((await listEntityTypes(d, a.manager)).items, []);
    const actor = requestActor(a.manager);
    const first = await createEntityType(d, actor, { label: "재료", icon_id: "leaf" });
    assertEquals(await createEntityType(d, actor, { label: "재료", icon_id: "leaf" }), first);
    const second = await createEntityType(d, requestActor(a.manager), { label: "상품" });
    const definition = await getEntitySchema(d, a.manager, { type_id: first.id });
    assertEquals(definition.schema.required, ["prop_1", "prop_2"]);
    assertEquals(definition.schema["x-identity-property"], "prop_2");
    assertEquals(definition.schema.properties.prop_2["x-identifier"], {
      allowed_kind_ids: ["00000000-0000-4000-8000-000000000001"],
      default_kind_id: "00000000-0000-4000-8000-000000000001",
    });
    assertEquals(definition.schema["x-title-template"], "$prop_1$");
    assertEquals("x-representative" in definition.schema.properties.prop_1, false);
    assertEquals((await getEntitySchema(d, a.manager, { type_id: second.id })).schema_version, 1);
    assertEquals((await listEntityTypes(d, b.manager)).items, []);
    assertEquals((await assertRejects(() => getEntityType(d, b.manager, first.id), AppError)).code, "not_found");
    assertEquals(
      (await assertRejects(() => getEntitySchema(d, b.manager, { type_id: first.id }), AppError)).code,
      "not_found",
    );
    const mutation = {
      expected_schema_version: first.schema_version,
      label: "材料",
      icon_id: "star",
      archived: true,
    };
    const updater = requestActor(a.manager);
    const changed = await updateEntityType(d, updater, first.id, mutation);
    assertEquals(await updateEntityType(d, updater, first.id, mutation), changed);
    assertEquals(changed.schema_version, 2);
    assertEquals((await listEntityTypes(d, a.manager)).items.map((row) => row.id), [second.id]);
    assertEquals(
      (await getEntitySchema(d, a.manager, { type_id: first.id, schema_version: 1 })).schema,
      definition.schema,
    );
    assertEquals((await listEntitySchemaVersions(d, a.manager, { type_id: first.id })).items.length, 2);
    const races = await Promise.allSettled(
      ["복원 A", "복원 B"].map((label) =>
        updateEntityType(d, requestActor(a.manager), first.id, {
          expected_schema_version: 2,
          label,
          archived: false,
        })
      ),
    );
    assertEquals(races.filter((r) => r.status === "fulfilled").length, 1);
    assertEquals((await getEntityType(d, a.manager, second.id)).schema_version, 1);
    await assertRejects(() =>
      runInWorkspace(
        sql,
        a.manager,
        { mode: "business", requirements: [{ target_kind: "settings", target_id: "*", access: "write" }] },
        async (tx) => {
          await tx`update app.entity_schema_versions set schema='{}'::jsonb where type_id=${first.id}`;
        },
      )
    );
    await assertRejects(
      async () => await createEntityType(d, requestActor(a.manager), { label: "잘못된 아이콘", icon_id: "unknown" }),
      AppError,
    );
    const afterRace = await getEntityType(d, a.manager, first.id);
    const noOp = await updateEntityType(d, requestActor(a.manager), first.id, {
      expected_schema_version: afterRace.schema_version,
      label: afterRace.label,
    });
    assertEquals(noOp.schema_version, afterRace.schema_version);
    assertEquals((await listEntitySchemaVersions(d, a.manager, { type_id: first.id })).items.length, 3);
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});
