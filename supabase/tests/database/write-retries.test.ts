import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, getEntity, updateEntity } from "../../functions/_shared/core/entity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) };
dbTest("same creation identity and stale version never repeat a business change", async () => {
  const f = await businessWorkspaceFixture(admin, sql), other = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await f.createKind("생성 재시도"), foreignKind = await other.createKind("다른 공간 생성");
    await f.grantKind(f.manager, kind.id, "write");
    await other.grantKind(other.manager, foreignKind.id, "write");
    const schema = { entity_type_id: kind.id, schema_version: kind.schema_version };
    const foreignSchema = { entity_type_id: foreignKind.id, schema_version: foreignKind.schema_version };
    const raw = crypto.randomUUID(), kindId = "00000000-0000-4000-8000-000000000001";
    const input = entityCreate.parse({
      ...schema,
      properties: { prop_1: "원본", prop_2: encodeIdentifierValue(kindId, raw) },
    });
    const created = await createEntity(deps, requestActor(f.manager), input);
    assertEquals(created.id, encodeIdentifierReference(input.entity_type_id, kindId, raw));
    await assertRejects(() => createEntity(deps, requestActor(f.manager), input), AppError);
    const collision = await assertRejects(() => createEntity(deps, requestActor(f.manager), input), AppError);
    assertEquals(collision.code, "conflict");
    assertEquals(collision.message.includes(String(input.properties.prop_1)), false);
    await assertRejects(() => getEntity(deps, other.manager, created.id), AppError);
    const foreign = await createEntity(deps, requestActor(other.manager), {
      ...input,
      ...foreignSchema,
      properties: { prop_1: "다른 소유자", prop_2: input.properties.prop_2 },
    });
    assertEquals(foreign.id, encodeIdentifierReference(foreignSchema.entity_type_id, kindId, raw));
    assertEquals(foreign.properties.prop_2, created.properties.prop_2);
    assertEquals((await getEntity(deps, other.manager, foreign.id)).properties.prop_1, "다른 소유자");
    assertEquals((await getEntity(deps, f.manager, created.id)).properties.prop_1, "원본");
    const patch = {
      schema_version: schema.schema_version,
      properties: { prop_1: "수정" },
      expected_version: created.version,
    };
    const updated = await updateEntity(deps, requestActor(f.manager), created.id, patch);
    await assertRejects(() => updateEntity(deps, requestActor(f.manager), created.id, patch), AppError);
    assertEquals((await getEntity(deps, f.manager, created.id)).version, updated.version);
    const [{ n }] =
      await admin`select count(*)::int n from app.records where workspace_id=${f.workspaceId} and record_kind='change'`;
    assertEquals(n, 2);
    const [{ removed }] =
      await admin`select to_regclass('app.request_results') is null and to_regclass('app.principle_versions') is null as removed`;
    assertEquals(removed, true);
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});
