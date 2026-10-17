import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
dbTest(
  "retired unconfigured originals are private, inaccessible to app roles and absent from current schema baselines",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct), owner = await fixtureOwner(admin);
    try {
      assertEquals((await admin`select to_regclass('app.entity_pairs') as name`)[0].name, null);
      assertEquals(
        (await admin`select to_regclass('private.retired_entity_pairs') as name`)[0].name,
        "private.retired_entity_pairs",
      );
      for (const role of ["app_user", "app_server", "app_worker", "anon", "authenticated", "service_role"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          assertEquals(
            (await admin`select has_table_privilege(${role},'private.retired_entity_pairs',${privilege}) as allowed`)[0]
              .allowed,
            false,
          );
        }
      }
      await assertRejects(() =>
        asUser(sql, owner.actor.userId, (tx) => tx`select * from private.retired_entity_pairs`)
      );
      await assertRejects(() =>
        asUser(
          sql,
          owner.actor.userId,
          (tx) => tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${owner.actor.userId},'a','b')`,
        )
      );
      const value = await asUser(
        sql,
        owner.actor.userId,
        async (tx) =>
          (await tx`select app.entity_schema_reference_baseline(${owner.actor.userId},${crypto.randomUUID()}) as value`)[
            0
          ].value,
      );
      assertEquals(Object.keys(value).sort(), ["records", "tasks", "typed_links"]);
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
