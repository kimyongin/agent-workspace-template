import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import {
  decodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
Deno.test("actual new identifier UOW metadata, generated request replay, lookup, immutability, tombstone restore", async () => {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const type = await f.createKind("식별자 실제 업무"), deps = { uow: new SqlEntityUnitOfWork(sql) };
    await f.grantKind(f.member, type.id, "write");
    const schema = await getEntitySchema({ uow: new SqlEntityTypeUnitOfWork(sql) }, f.member, { type_id: type.id });
    assertEquals(schema.schema["x-identity-property"], "prop_2");
    assertEquals(schema.identifier_kinds?.map((k) => k.id), ["00000000-0000-4000-8000-000000000001"]);
    const request = businessRequest(f.member),
      input = { entity_type_id: type.id, schema_version: 1, properties: { prop_1: "이름" } };
    const created = await entities.createEntity(deps, request, input);
    assertEquals(
      created.properties.prop_2,
      encodeIdentifierValue(decodeIdentifierReference(created.id).kind_id, decodeIdentifierReference(created.id).raw),
    );
    assert(/^\d{8}-[A-Z0-9]{8}$/.test(decodeIdentifierReference(created.id).raw));
    assertEquals((await entities.createEntity(deps, request, input)).id, created.id);
    assertEquals(
      (await entities.lookupEntity(deps, f.member, type.id, String(created.properties.prop_2)))?.id,
      created.id,
    );
    assertEquals(
      (await assertRejects(() =>
        entities.updateEntity(deps, businessRequest(f.member), created.id, {
          schema_version: 1,
          expected_version: 1,
          properties: { prop_2: "00000000-0000-4000-8000-000000000001:replacement" },
        }), AppError)).code,
      "invalid_input",
    );
    const changed = await entities.updateEntity(deps, businessRequest(f.member), created.id, {
      schema_version: 1,
      expected_version: 1,
      properties: { prop_1: "更新" },
    });
    assertEquals(changed.properties.prop_2, created.properties.prop_2);
    await entities.deleteEntity(deps, businessRequest(f.member), created.id, changed.version);
    const deleted = (await entities.lookupEntity(deps, f.member, type.id, String(created.properties.prop_2)))!;
    assert(deleted.deleted_at);
    await assertRejects(
      () =>
        entities.createEntity(deps, businessRequest(f.member), {
          ...input,
          properties: { ...input.properties, prop_2: String(created.properties.prop_2) },
        }),
      AppError,
    );
    const restored = await entities.restoreEntity(deps, businessRequest(f.member), deleted.id, {
      schema_version: 1,
      expected_version: deleted.version,
    });
    assertEquals([restored.id, restored.deleted_at, restored.properties.prop_1], [created.id, null, "更新"]);
  } finally {
    await f.cleanup();
    await sql.end();
    await admin.end();
  }
});
