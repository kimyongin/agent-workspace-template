import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, getEntity, updateEntity } from "../../functions/_shared/core/entity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) };
dbTest("same creation identity and stale version never repeat a business change", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const schema = await entityFixture(admin, f.actor.userId),
      foreignSchema = await entityFixture(admin, other.actor.userId);
    const input = entityCreate.parse({
      ...schema,
      source: "app",
      external_id: crypto.randomUUID(),
      properties: { prop_1: "원본" },
    });
    const created = await createEntity(deps, requestActor(f.actor), input);
    assertEquals(created.id, `app:${input.external_id}`);
    await assertRejects(() => createEntity(deps, requestActor(f.actor), input), AppError);
    const collision = await assertRejects(() => createEntity(deps, requestActor(f.actor), input), AppError);
    assertEquals(collision.code, "conflict");
    assertEquals(collision.message.includes(String(input.properties.prop_1)), false);
    await assertRejects(() => getEntity(deps, other.actor, created.id), AppError);
    const foreign = await createEntity(deps, requestActor(other.actor), {
      ...input,
      ...foreignSchema,
      properties: { prop_1: "다른 소유자" },
    });
    assertEquals(foreign.id, created.id);
    assertEquals((await getEntity(deps, other.actor, foreign.id)).properties.prop_1, "다른 소유자");
    assertEquals((await getEntity(deps, f.actor, created.id)).properties.prop_1, "원본");
    const patch = {
      schema_version: schema.schema_version,
      properties: { prop_1: "수정" },
      expected_version: created.version,
    };
    const updated = await updateEntity(deps, requestActor(f.actor), created.id, patch);
    await assertRejects(() => updateEntity(deps, requestActor(f.actor), created.id, patch), AppError);
    assertEquals((await getEntity(deps, f.actor, created.id)).version, updated.version);
    const [{ n }] =
      await admin`select count(*)::int n from app.records where owner_id=${f.actor.userId} and record_kind='change'`;
    assertEquals(n, 2);
    const [{ removed }] =
      await admin`select to_regclass('app.request_results') is null and to_regclass('app.principle_versions') is null as removed`;
    assertEquals(removed, true);
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});
