import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const migration = await readFile(
  new URL("../supabase/migrations/20261014224340_entity_issuer_registry.sql", import.meta.url),
  "utf8",
);

for (const populated of [false, true]) {
  test(`issuer registry upgrade with ${populated ? "existing types and issuer settings" : "an empty store"}`, async () => {
    assert.ok(process.env.LOCAL_DB_URL, "LOCAL_DB_URL required");
    const url = new URL(process.env.LOCAL_DB_URL);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "local DB only");
    const admin = postgres(url.href, { max: 1, prepare: false });
    const name = `workspace_issuer_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
    let sql, created = false;
    try {
      await admin.unsafe(`create database "${name}" template template0`);
      created = true;
      url.pathname = `/${name}`;
      sql = postgres(url.href, { max: 1, prepare: false });
      // Only the pre-upgrade tables used by the real migration are needed.
      await sql.unsafe(`
      create schema auth; create schema app; create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table app.entity_types(owner_id uuid not null, id uuid not null, label text not null, primary key(owner_id,id));
      create table app.entities(owner_id uuid,entity_type_id uuid,source text);
      create table app.user_business_settings(owner_id uuid,id text,settings jsonb);
    `);
      const owner = crypto.randomUUID(), other = crypto.randomUUID();
      if (populated) {
        await sql`insert into auth.users values(${owner}),(${other})`;
        for (let n = 0; n < 6; n++) {
          await sql`insert into app.entity_types values(${owner},${crypto.randomUUID()},${`kind ${n}`})`;
        }
        await sql`insert into app.entity_types values(${other},${crypto.randomUUID()},'other owner')`;
        await sql`insert into app.user_business_settings values(${owner},'entity_identity',${
          sql.json({
            sources: [{ code: "app", label: "앱" }, { code: "coupang", label: "쿠팡" }],
            default_source: "coupang",
          })
        })`;
      }
      const before = await sql`select * from app.entity_types order by owner_id,id`;
      await sql.begin((tx) => tx.unsafe(migration));
      assert.deepEqual(await sql`select * from app.entity_types order by owner_id,id`, before);
      const [counts] =
        await sql`select (select count(*)::int from app.entity_type_identity) as identities,(select count(*)::int from app.entity_type_identity_sources) as mappings,(select count(*)::int from pg_class where oid in ('app.entity_issuers'::regclass,'app.entity_identifier_rules'::regclass,'app.entity_type_identity'::regclass,'app.entity_type_identity_sources'::regclass) and relrowsecurity) as rls`;
      assert.deepEqual({ ...counts }, { identities: populated ? 7 : 0, mappings: populated ? 13 : 0, rls: 4 });
      if (populated) {
        assert.equal(
          (await sql`select * from app.entity_type_identity where owner_id=${owner} and default_source='coupang'`)
            .length,
          6,
        );
        const [rule] =
          await sql`select generation from app.entity_identifier_rules where owner_id=${owner} and source='coupang'`;
        assert.equal(rule.generation, "direct");
        assert.equal((await sql`select * from app.entity_issuers where owner_id=${other}`).length, 1);
        await assert.rejects(
          sql.begin((tx) => tx`update app.entity_type_identity set default_source='missing' where owner_id=${owner}`),
          (error) => error.code === "23503",
        );
        assert.equal(
          (await sql`select * from app.entity_type_identity where owner_id=${owner} and default_source='coupang'`)
            .length,
          6,
        );
      }
    } finally {
      await sql?.end();
      if (created) await admin.unsafe(`drop database "${name}"`);
      await admin.end();
    }
  });
}
