import { assertEquals, assertRejects } from "@std/assert";
import { connect, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { directEntitySource } from "./_entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

Deno.test("identifier fixture publishes reviewed settings through actual analysis and creates the exact selected pair", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 3, prepare: false });
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    const type = await fixture.createKind("공개 식별 필드 설정");
    await fixture.grantKind(fixture.manager, type.id, "write");
    const setup = await directEntitySource(sql, fixture.manager, type.id);
    const published = await getEntitySchema(fixture.typeDeps, fixture.manager, { type_id: type.id });
    assertEquals(published.schema_version, 2);
    assertEquals(setup.schema, { entity_type_id: type.id, schema_version: 2 });
    assertEquals(setup.property_key, "prop_2");
    assertEquals(published.schema.properties.prop_2["x-identifier"], {
      allowed_kind_ids: ["00000000-0000-4000-8000-000000000001", setup.rule.id],
      default_kind_id: setup.rule.id,
    });
    const deps = { uow: new SqlEntityUnitOfWork(sql) };
    const properties = { prop_1: "보존", prop_2: encodeIdentifierValue(setup.rule.id, "000Ab:/한글%") };
    await assertRejects(() =>
      createEntity(deps, businessRequest(fixture.manager), {
        entity_type_id: type.id,
        schema_version: 1,
        properties,
      }), AppError);
    const saved = await createEntity(deps, businessRequest(fixture.manager), { ...setup.schema, properties });
    assertEquals(saved.id, encodeIdentifierReference(type.id, setup.rule.id, "000Ab:/한글%"));
    assertEquals((await getEntity(deps, fixture.manager, saved.id)).properties, properties);
  } finally {
    await fixture.cleanup();
    await sql.end();
    await admin.end();
  }
});
