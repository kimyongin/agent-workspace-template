import { assertEquals, assertRejects } from "@std/assert";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { asUser, connect, dbTest, urls } from "./_db.ts";
dbTest(
  "retired unconfigured originals are private, inaccessible to app roles and absent from current schema baselines",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct), owner = await businessWorkspaceFixture(admin, sql);
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
        asUser(sql, owner.manager.userId, (tx) => tx`select * from private.retired_entity_pairs`)
      );
      await assertRejects(() =>
        asUser(
          sql,
          owner.manager.userId,
          (tx) => tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${owner.manager.userId},'a','b')`,
        )
      );
      // Retiring the table must not leave an executable privileged helper or view.
      assertEquals(
        (await admin`select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','private') and p.prokind in ('f','p') and p.prosrc ~ '(entity_pairs|retired_entity_pairs)'`)
          .length,
        0,
      );
      assertEquals(
        (await admin`select schemaname,viewname from pg_views where schemaname in ('app','private','public') and definition ~ '(entity_pairs|retired_entity_pairs)'`)
          .length,
        0,
      );
      assertEquals((await admin`select to_regprocedure('app.rekey_entity(text,text,text)') as name`)[0].name, null);
      const kind = await owner.createKind("현재 참조 범위");
      await owner.grantKind(owner.manager, kind.id, "read");
      const value = await runInWorkspace(
        sql,
        owner.manager,
        {
          mode: "business",
          requirements: [{ target_kind: "settings", target_id: "*", access: "read" }, {
            target_kind: "entity_type",
            target_id: kind.id,
            access: "read",
          }],
        },
        async (tx) =>
          (await tx`select app.entity_schema_reference_baseline(${owner.workspaceId},${kind.id}) as value`)[0].value,
      );
      assertEquals(Object.keys(value).sort(), ["records", "tasks", "typed_links"]);
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
