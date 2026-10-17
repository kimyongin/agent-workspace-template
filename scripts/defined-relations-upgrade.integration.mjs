import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
const migration = await readFile(
  new URL("../supabase/migrations/20261017054939_defined_entity_relations_only.sql", import.meta.url),
  "utf8",
);
test("defined-only upgrade preserves exact historical links, business context, accepted baselines and receipt expiry", async () => {
  assert.ok(process.env.LOCAL_DB_URL, "LOCAL_DB_URL required");
  const url = new URL(process.env.LOCAL_DB_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "local DB only");
  const admin = postgres(url.href, { max: 1, prepare: false, onnotice() {} });
  const database = `workspace_relations_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  let sql, created = false;
  try {
    await admin.unsafe(`create database "${database}" template template0`);
    created = true;
    url.pathname = `/${database}`;
    sql = postgres(url.href, { max: 1, prepare: false, onnotice() {} });
    await sql.unsafe(`
      create schema app;create schema private;
      create table app.entities(owner_id uuid,id text,entity_type_id uuid,primary key(owner_id,id));
      create table app.entity_pairs(owner_id uuid,entity_id text,other_id text,created_at timestamptz,primary key(owner_id,entity_id,other_id),foreign key(owner_id,entity_id) references app.entities(owner_id,id),foreign key(owner_id,other_id) references app.entities(owner_id,id));
      alter table app.entity_pairs enable row level security;
      create policy entity_pairs_owner on app.entity_pairs for all to app_user using(true) with check(true);
      grant select,insert,delete on app.entity_pairs to app_user;
      create table app.entity_relation_definitions(owner_id uuid,id uuid,version integer);
      create table app.entity_relation_links(owner_id uuid,definition_id uuid,left_entity_id text,right_entity_id text,created_at timestamptz);
      create table app.tasks(owner_id uuid,id text,entity_ids text[],entity_context jsonb);
      create table app.records(owner_id uuid,id text,task_id text,entity_ids text[],entity_context jsonb,record_kind text,body text);
      create table private.request_results(owner_id uuid,request_key uuid,result jsonb,expires_at timestamptz);
      create table app.entity_schema_migrations(owner_id uuid,id uuid,reference_baseline jsonb,source_expires_at timestamptz);
    `);
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), type = crypto.randomUUID();
    for (const user of [owner, other]) {
      await sql`insert into app.entities values(${user},'a',${type}),(${user},'b',${type})`;
      await sql`insert into app.entity_pairs values(${user},'a','b','2026-10-01T00:00:00Z')`;
      await sql`insert into app.tasks values(${user},'t',array['a'],${sql.json([{ id: "a", title: "당시 자료" }])})`;
      await sql`insert into app.records values(${user},'r','t',array['a','b'],${
        sql.json([{ id: "a", title: "당시 자료" }])
      },'change','보존 메모')`;
      await sql`insert into private.request_results values(${user},${crypto.randomUUID()},'{"changed":true}','2026-10-31T00:00:00Z')`;
      await sql`insert into app.entity_schema_migrations values(${user},${crypto.randomUUID()},'{"pairs":[["a","b","2026-10-01T00:00:00Z"]]}','2026-10-31T00:00:00Z')`;
    }
    const snapshot = async () => ({
      entities: await sql`select * from app.entities order by owner_id,id`,
      tasks: await sql`select * from app.tasks order by owner_id,id`,
      records: await sql`select * from app.records order by owner_id,id`,
      receipts: await sql`select * from private.request_results order by owner_id`,
      migrations: await sql`select * from app.entity_schema_migrations order by owner_id`,
    });
    const original =
      await sql`select * from app.entity_pairs where owner_id in (${owner},${other}) and entity_id='a' and other_id='b' order by owner_id`;
    const before = await snapshot();
    await sql.begin((tx) => tx.unsafe(migration));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      await sql`select * from private.retired_entity_pairs where owner_id in (${owner},${other}) and entity_id='a' and other_id='b' order by owner_id`,
      original,
    );
    assert.equal((await sql`select to_regclass('app.entity_pairs') as name`)[0].name, null);
    assert.equal((await sql`select count(*)::int as n from app.entity_relation_definitions`)[0].n, 0);
    const [baseline] = await sql`select app.entity_schema_reference_baseline(${owner},${type}) as value`;
    assert.deepEqual(Object.keys(baseline.value).sort(), ["records", "tasks", "typed_links"]);
    assert.notDeepEqual(baseline.value, before.migrations[0].reference_baseline);
    await sql`delete from app.entities where owner_id=${owner} and id in ('a','b')`;
    assert.deepEqual(
      await sql`select * from private.retired_entity_pairs where owner_id in (${owner},${other}) and entity_id='a' and other_id='b' order by owner_id`,
      original,
    );
    for (const role of ["app_user", "app_server", "app_worker", "anon", "authenticated", "service_role"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal(
          (await sql`select has_table_privilege(${role},'private.retired_entity_pairs',${privilege}) as allowed`)[0]
            .allowed,
          false,
        );
      }
    }
  } finally {
    await sql?.end();
    if (created) await admin.unsafe(`drop database "${database}"`);
    await admin.end();
  }
});
