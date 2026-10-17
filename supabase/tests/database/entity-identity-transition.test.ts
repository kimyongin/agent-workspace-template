import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";

const predecessor = await Deno.readTextFile(new URL("./fixtures/entity-identity-before.sql", import.meta.url));
const migration = await Deno.readTextFile(
  new URL("../../migrations/20261015012000_immutable_type_scoped_entity_identity.sql", import.meta.url),
);
// Execute the exact original guard against its historical predecessor, not today's schema.
const guard = migration.slice(migration.indexOf("do $$"), migration.indexOf("end $$;") + "end $$;".length);
const stores = [
  "app.entities",
  "app.entity_tags",
  "app.entity_pairs",
  "app.tasks",
  "app.records",
  "app.entity_schema_analyses",
  "app.entity_schema_migrations",
  "private.entity_schema_analysis_rows",
  "private.entity_schema_migration_rows",
  "private.request_results",
] as const;

dbTest("identity transition rejects a nonempty related store without deleting or rewriting its data", async () => {
  const url = new URL(urls.admin);
  assert(["127.0.0.1", "localhost"].includes(url.hostname), "historical fixture requires a loopback DB");
  const admin = connect(url.href, { max: 1 });
  const database = `identity_transition_${crypto.randomUUID().replaceAll("-", "")}`;
  let isolated: ReturnType<typeof connect> | undefined, created = false;
  try {
    await admin.unsafe(`create database "${database}" template template0`);
    created = true;
    url.pathname = `/${database}`;
    isolated = connect(url.href, { max: 1 });
    const sql = isolated;
    await sql.unsafe(predecessor);
    const type = crypto.randomUUID();
    for (const owner of [crypto.randomUUID(), crypto.randomUUID()]) {
      const analysis = crypto.randomUUID(), job = crypto.randomUUID(), key = crypto.randomUUID();
      const entity = "seller:00123:A/한글_%", other = "seller:다른 원본";
      const properties = { prop_1: "보존할 시험 자료", prop_2: 0 };
      const context = [{ id: entity, title: "당시 자료 이름" }];
      await sql`insert into app.entities values(${owner},${entity},${type},'seller','00123:A/한글_%',${
        sql.json(properties)
      })`;
      await sql`insert into app.entity_tags values(${owner},${entity},'original-tag')`;
      await sql`insert into app.entity_pairs values(${owner},${entity},${other},'2026-10-01T00:00:00Z')`;
      await sql`insert into app.tasks values(${owner},'task',array[${entity}],${sql.json(context)})`;
      await sql`insert into app.records values(${owner},'record',array[${entity}],${sql.json(context)},${
        sql.json({ target_kind: "entity", before: { entity_ids: [entity] } })
      },'보존 메모')`;
      await sql`insert into app.entity_schema_analyses values(${owner},${analysis},'succeeded',${"a".repeat(64)})`;
      await sql`insert into app.entity_schema_migrations values(${owner},${job},'succeeded','{"version":1}','2026-10-31T00:00:00Z')`;
      await sql`insert into private.entity_schema_analysis_rows values(${owner},${analysis},${entity},${
        sql.json(properties)
      })`;
      await sql`insert into private.entity_schema_migration_rows values(${owner},${job},${entity},${
        sql.json(properties)
      })`;
      await sql`insert into private.request_results values(${owner},${key},'entity.create',${"b".repeat(64)},${
        sql.json({ id: entity, entity_ids: [entity], properties })
      },'2026-10-31T00:00:00Z')`;
    }
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const store of stores) {
        result[store] = (await sql.unsafe(`select to_jsonb(t) as row from ${store} t order by to_jsonb(t)::text`)).map((
          r,
        ) => r.row);
      }
      return result;
    };
    const before = await snapshot();
    assert(guard.startsWith("do $$") && guard.endsWith("end $$;"));
    const error = await assertRejects(() => sql.begin((tx) => tx.unsafe(guard)));
    assertEquals((error as { code?: string }).code, "55000");
    assertEquals((error as Error).message.startsWith("entity_identity_transition_requires_empty_related_store"), true);
    assertEquals(await snapshot(), before);
  } finally {
    try {
      await isolated?.end();
      if (created) await admin.unsafe(`drop database "${database}"`);
    } finally {
      await admin.end();
    }
  }
});
