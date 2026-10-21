import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
const predecessor = await Deno.readTextFile(new URL("./fixtures/field-identifiers-before.sql", import.meta.url));
const migration = await Deno.readTextFile(
  new URL("../../migrations/20261021174857_field_based_entity_identifiers.sql", import.meta.url),
);
const guard = migration.slice(migration.indexOf("do $$"), migration.indexOf("end $$;") + "end $$;".length);

dbTest(
  "field cutover admits expired receipts while blocking live or unresolved old work without changing evidence",
  async () => {
    const admin = connect(urls.admin, { max: 1 }), name = "field_cutover_" + crypto.randomUUID().replaceAll("-", "");
    let isolated: ReturnType<typeof connect> | undefined;
    try {
      await admin`create database ${admin(name)} template template0`;
      const url = new URL(urls.admin);
      url.pathname = "/" + name;
      isolated = connect(url.href, { max: 1 });
      const sql = isolated;
      await sql.unsafe(predecessor);
      const owner = crypto.randomUUID(),
        workspace = crypto.randomUUID(),
        key = crypto.randomUUID(),
        fingerprint = "b".repeat(64);
      await sql`insert into private.workspace_request_results values(${owner},${workspace},${key},'entity.create',${fingerprint},null,'2026-10-22T00:00:00Z')`;
      await sql`insert into private.request_results values(${owner},${key},'entity.create',${fingerprint},null,'2026-10-22T00:00:00Z')`;
      await sql`insert into app.tasks(id) values('unrelated-task')`;
      await sql`insert into app.records(id,body) values('task-result','Preserve the original crm:001 text and entity.create words')`;
      const snapshot = async () => ({
        workspace: await sql`select * from private.workspace_request_results`,
        legacy: await sql`select * from private.request_results`,
        tasks: await sql`select * from app.tasks`,
        records: await sql`select * from app.records`,
      });
      const expired = await snapshot();
      await sql.begin((tx) => tx.unsafe(guard));
      assertEquals(
        await snapshot(),
        expired,
        "expired keys, fingerprints, completion times and unrelated bodies remain exact",
      );
      const rejected = async () => {
        const before = await snapshot();
        const error = await assertRejects(() => sql.begin((tx) => tx.unsafe(guard)));
        assertEquals((error as { code?: string }).code, "55000");
        assertEquals((error as Error).message, "field_identifier_cutover_requires_explicit_reset");
        assertEquals(await snapshot(), before);
      };
      for (const table of ["private.workspace_request_results", "private.request_results"]) {
        for (
          const operation of [
            "entity.create",
            "entity-type.create",
            "entity-schema-change.create",
            "entity-relation.connect",
            "data-model.apply",
          ]
        ) {
          await sql`update ${sql(table)} set operation=${operation},result='{"id":"old-entity"}'`;
          await rejected();
          await sql`update ${sql(table)} set result=null,completed_at=null`;
          await rejected();
          await sql`update ${sql(table)} set result=null,completed_at='2026-10-22T00:00:00Z'`;
        }
      }
      await sql`update private.workspace_request_results set operation='task.create',result='{"body":"entity.create is just text"}'`;
      await sql.begin((tx) => tx.unsafe(guard));
      await sql`update private.workspace_request_results set result='{"entity_ids":["old-entity"]}'`;
      await rejected();
      await sql`update private.workspace_request_results set result=null`;
      const type = crypto.randomUUID();
      await sql`insert into app.entity_types values(${workspace},${type},1)`;
      await sql`insert into app.entity_schema_versions values(${workspace},${type},1,'{"properties":{"prop_1":{"type":"string"}},"required":["prop_1"]}')`;
      await rejected();
      assertEquals(
        (await sql`select count(*)::int n from app.entity_schema_versions`)[0].n,
        1,
        "an empty incompatible current definition is not silently accepted or removed",
      );
    } finally {
      await isolated?.end();
      await admin`drop database if exists ${admin(name)} with(force)`;
      await admin.end();
    }
  },
);
