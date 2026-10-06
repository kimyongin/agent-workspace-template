import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, getEntity, updateEntity } from "../../functions/_shared/core/entity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) };
dbTest("same creation UUID and stale version never repeat a business change", async () => {
  const f = await fixtureOwner(admin);
  try {
    const input = entityCreate.parse({ id: crypto.randomUUID(), prop1: "원본" });
    const created = await createEntity(deps, f.actor, input);
    assertEquals(created.id, input.id);
    await assertRejects(() => createEntity(deps, f.actor, input), AppError);
    const patch = { prop1: "수정", expected_version: created.version };
    const updated = await updateEntity(deps, f.actor, created.id, patch);
    await assertRejects(() => updateEntity(deps, f.actor, created.id, patch), AppError);
    assertEquals((await getEntity(deps, f.actor, created.id)).version, updated.version);
    const [{ n }] =
      await admin`select count(*)::int n from app.records where owner_id=${f.actor.userId} and record_kind='change'`;
    assertEquals(n, 2);
    const [{ removed }] =
      await admin`select to_regclass('app.request_results') is null and to_regclass('app.principle_versions') is null as removed`;
    assertEquals(removed, true);
  } finally {
    await f.cleanup();
  }
});
