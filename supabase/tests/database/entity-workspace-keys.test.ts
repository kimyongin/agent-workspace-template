import { assertEquals } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });

// Storage identity is an explicitly agreed seam for #551: catalog assertions
// distinguish a real primary key from the old nullable UNIQUE compatibility key.
const keys: Record<string, string[]> = {
  "app.entities": ["workspace_id", "id"],
  "app.entity_types": ["workspace_id", "id"],
  "app.entity_schema_versions": ["workspace_id", "type_id", "schema_version"],
  "app.entity_issuers": ["workspace_id", "code"],
  "app.entity_identifier_rules": ["workspace_id", "id"],
  "app.entity_relation_definitions": ["workspace_id", "id"],
  "app.entity_relation_links": ["workspace_id", "definition_id", "left_entity_id", "right_entity_id"],
  "app.data_model_changes": ["workspace_id", "id"],
  "app.data_model_children": ["workspace_id", "model_id", "type_ref"],
  "app.entity_schema_changes": ["workspace_id", "id"],
  "app.entity_schema_analyses": ["workspace_id", "id"],
  "app.entity_schema_migrations": ["workspace_id", "id"],
  "private.entity_schema_analysis_rows": ["workspace_id", "analysis_id", "entity_id"],
  "private.entity_schema_migration_rows": ["workspace_id", "job_id", "entity_id"],
};

dbTest("entity model stores require their workspace identity as a real primary key", async () => {
  assertEquals(
    (await admin`select to_regclass('app.entity_type_identity') as identity,to_regclass('app.entity_type_identity_sources') as sources`)[
      0
    ],
    { identity: null, sources: null },
  );
  for (const [table, expected] of Object.entries(keys)) {
    const columns = await admin<{ attname: string; attnotnull: boolean }[]>`
      select a.attname,a.attnotnull from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality k(attnum,position)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
      where c.conrelid=${table}::regclass and c.contype='p' order by k.position`;
    assertEquals(columns.map((column) => column.attname), expected, table);
    assertEquals(columns.every((column) => column.attnotnull), true, table);
    const legacy = await admin`select c.conname from pg_constraint c
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.conrelid=${table}::regclass and c.contype in ('p','u','f') and a.attname='owner_id'
      and (c.contype<>'f' or c.confrelid<>'auth.users'::regclass)`;
    assertEquals([...legacy], [], `${table} has no owner identity or business reference`);
  }
});

dbTest(
  "the same entity string identity belongs independently to two workspaces and duplicates fail within one",
  async () => {
    const { businessRequest, businessWorkspaceFixture } = await import("./_workspace-business.ts");
    const { SqlEntityUnitOfWork } = await import("../../functions/_shared/adapters/supabase/entity-store.ts");
    const { entityCreate } = await import("../../functions/_shared/contracts/entity.ts");
    const entities = await import("../../functions/_shared/core/entity/application.ts");
    const sql = connect(urls.direct, { max: 2, prepare: false });
    const fixture = await businessWorkspaceFixture(admin, sql);
    try {
      const other = await fixture.addWorkspace("독립된 자료 키");
      const kind = await fixture.createKind("공간별 키");
      await fixture.grantKind(fixture.manager, kind.id, "write");
      const deps = { uow: new SqlEntityUnitOfWork(sql) };
      const created = await entities.createEntity(
        deps,
        businessRequest(fixture.manager),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "첫 공간의 자료" },
        }),
      );
      // Duplicate immutable kind IDs represent two independently imported model
      // definitions. Privileged preparation bypasses business triggers only here;
      // PK/NOT NULL constraints remain active, and reads use the public usecase.
      await admin.begin(async (tx) => {
        await tx`set local session_replication_role='replica'`;
        await tx`insert into app.entity_types(workspace_id,id,schema_version)
        values(${other.workspaceId},${kind.id},1)`;
        await tx`insert into app.entity_schema_versions(workspace_id,schema)
        select ${other.workspaceId},schema from app.entity_schema_versions
        where workspace_id=${fixture.workspaceId} and type_id=${kind.id} and schema_version=1`;
        await tx`insert into app.entity_issuers(workspace_id,code,label,system)
        values(${other.workspaceId},'app','앱',true)`;
        await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
        values(${other.workspaceId},${created.id},${kind.id},1,${
          tx.json({ ...created.properties, prop_1: "둘째 공간의 자료" })
        })`;
      });
      await fixture.grantKind(other.manager, kind.id, "read");
      assertEquals((await entities.getEntity(deps, fixture.manager, created.id)).title, "첫 공간의 자료");
      assertEquals((await entities.getEntity(deps, other.manager, created.id)).title, "둘째 공간의 자료");
      let code: string | undefined;
      try {
        await admin.begin(async (tx) => {
          await tx`set local session_replication_role='replica'`;
          await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
          values(${other.workspaceId},${created.id},${kind.id},1,${tx.json(created.properties)})`;
        });
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      assertEquals(code, "23505");
    } finally {
      await fixture.cleanup();
      await sql.end();
    }
  },
);
