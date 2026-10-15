import { assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { requestActor } from "../_request.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";

dbTest("identity transition rejects a nonempty related store without deleting or rewriting its data", async () => {
  const admin = connect(urls.admin), sql = connect(urls.direct);
  const owner = await fixtureOwner(admin);
  const deps = { uow: new SqlEntityUnitOfWork(sql) };
  try {
    const schema = await entityFixture(admin, owner.actor.userId);
    const saved = await createEntity(
      deps,
      requestActor(owner.actor),
      entityCreate.parse({
        ...schema,
        external_id: "00123:A/한글_%",
        properties: { prop_1: "보존할 시험 자료" },
      }),
    );
    const before = await getEntity(deps, owner.actor, saved.id);
    const migration = await Deno.readTextFile(
      new URL(
        "../../migrations/20261015012000_immutable_type_scoped_entity_identity.sql",
        import.meta.url,
      ),
    );
    const guard = migration.slice(migration.indexOf("do $$"), migration.indexOf("end $$;") + "end $$;".length);
    const error = await assertRejects(() => admin.begin((tx) => tx.unsafe(guard)));
    assertEquals((error as { code?: string }).code, "55000");
    assertEquals((error as Error).message.startsWith("entity_identity_transition_requires_empty_related_store"), true);
    assertEquals(await getEntity(deps, owner.actor, saved.id), before);
    const [receipt] =
      await admin`select count(*)::int count from private.request_results where owner_id=${owner.actor.userId} and operation='entity.create'`;
    assertEquals(receipt.count, 1);
  } finally {
    await owner.cleanup();
    await sql.end();
    await admin.end();
  }
});
