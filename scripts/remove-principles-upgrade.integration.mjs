import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
const migration = await readFile(new URL("../supabase/migrations/20261015171304_remove_principles.sql", import.meta.url), "utf8");
for (const populated of [false, true]) {
  test(`principle removal upgrades ${populated ? "existing content and replay copies" : "an empty store"}`, async () => {
    assert.ok(process.env.LOCAL_DB_URL, "LOCAL_DB_URL required");
    const url = new URL(process.env.LOCAL_DB_URL);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "local DB only");
    const admin = postgres(url.href, { max: 1, prepare: false, onnotice() {} });
    const name = `workspace_remove_principles_${crypto.randomUUID().replaceAll("-", "")}`;
    let sql, created = false;
    try {
      await admin.unsafe(`create database "${name}" template template0`);
      created = true; url.pathname = `/${name}`;
      sql = postgres(url.href, { max: 1, prepare: false, onnotice() {} });
      // Minimal predecessor tables touched by the real migration. Live application roles are unchanged.
      await sql.unsafe(`
        create schema app; create schema auth; create schema private; create schema pgmq;
        create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
        create table app.principles(owner_id uuid,id text,title text,body text);
        create table app.records(owner_id uuid,id text,body text,record_kind text,change_metadata jsonb,applied_principle_snapshots jsonb);
        create table app.tasks(owner_id uuid,id text,body text);
        create table app.entities(owner_id uuid,id text,properties jsonb);
        create table app.user_business_settings(owner_id uuid,id text,settings jsonb,version integer,updated_at timestamptz);
        create table private.request_results(owner_id uuid,operation text,result jsonb);
        create table private.passage_effects(owner_id uuid,record_id text);
        create table app.search_chunks(owner_id uuid,record_id text);
        create table app.search_index_state(owner_id uuid,id text);
        create table pgmq.q_search_index(message jsonb);
        create table pgmq.a_search_index(message jsonb);
        create function pgmq.read(text,integer,integer,jsonb) returns table(msg_id bigint,read_ct integer) language sql as 'select null::bigint,null::integer where false';
      `);
      const owners = [crypto.randomUUID(), crypto.randomUUID()];
      if (populated) for (const owner of owners) {
        const profile = { nickname: "keep", workspace_navigation: { version: 1, refs: [{kind:"builtin",id:"principles"},{kind:"builtin",id:"records"}] } };
        await sql`insert into auth.users values(${owner},${sql.json(profile)})`;
        await sql`insert into app.principles values(${owner},'old-rule','private rule','REMOVE-ME')`;
        await sql`insert into app.tasks values(${owner},'task','keep task')`;
        await sql`insert into app.entities values(${owner},'entity','{"prop_1":"keep material"}')`;
        await sql`insert into app.records values(${owner},'change','REMOVE-ME','change','{"target_kind":"principle"}','[]')`;
        const capture = `이관 캡처: 2026-10-05 01:02:03+00 / 원본: principle ${crypto.randomUUID()} / 조각: 1/2\n실제 적용 시각이 아닙니다. 원본 시각과 captured_at 의미는 아래 자료 그대로 보존합니다.\n\nREMOVE-ME`;
        const context = capture.replace('원본: principle ', '원본: record_principle_context ');
        for (const [id,body] of [["capture",capture],["context",context]]) {
          await sql`insert into app.records values(${owner},${id},${body},'user',null,'[]')`;
        }
        await sql`insert into app.records values(${owner},'keep','원칙이라는 단어도 일반 기록은 보존','user',null,'[{"body":"REMOVE-ME"}]')`;
        await sql`insert into app.user_business_settings values(${owner},'record_templates','{"principle":{"create":{"memo":"REMOVE-ME"}},"task":{"create":{"memo":"keep template"}}}',4,now())`;
        await sql`insert into private.request_results values(${owner},'principle.create','{"id":"old-rule","body":"REMOVE-ME"}')`;
        await sql`insert into private.request_results values(${owner},'record.update','{"record":{"id":"change","record_kind":"change","body":"REMOVE-ME"}}')`;
        await sql`insert into private.request_results values(${owner},'record.update','{"record":{"id":"keep","body":"keep","applied_principle_snapshots":[{"body":"REMOVE-ME"}]}}')`;
        await sql`insert into private.request_results values(${owner},'settings.update','{"settings":{"record_templates":{"principle":{"create":{"memo":"REMOVE-ME"}},"task":{}}}}')`;
        // IDs are unique per table. Matching task/tag IDs must retain their 30-day replay.
        await sql`insert into private.request_results values(${owner},'task.create','{"id":"change","body":"keep task replay"}')`;
        await sql`insert into private.request_results values(${owner},'tag.create','{"id":"change","name":"keep tag replay"}')`;
        for (const id of ['change','capture','context','keep']) {
          await sql`insert into private.passage_effects values(${owner},${id})`;
          await sql`insert into app.search_chunks values(${owner},${id})`;
          await sql`insert into app.search_index_state values(${owner},${id})`;
          const message = sql.json({owner_id:owner,kind:'record',id});
          await sql`insert into pgmq.q_search_index values(${message})`;
          await sql`insert into pgmq.a_search_index values(${message})`;
        }
        const legacyMessage = sql.json({owner_id:owner,kind:'principle',id:'old-rule'});
        await sql`insert into pgmq.q_search_index values(${legacyMessage})`;
        await sql`insert into pgmq.a_search_index values(${legacyMessage})`;
      }
      await sql.begin(tx=>tx.unsafe(migration));
      assert.equal((await sql`select to_regclass('app.principles') value`)[0].value,null);
      assert.equal((await sql`select count(*)::int n from information_schema.columns where table_schema='app' and table_name='records' and column_name='applied_principle_snapshots'`)[0].n,0);
      assert.equal((await sql`select count(*)::int n from app.records`)[0].n,populated?2:0);
      if (populated) for (const owner of owners) {
        assert.deepEqual((await sql`select id from app.records where owner_id=${owner}`).map(r=>r.id),['keep']);
        for (const table of ['private.passage_effects','app.search_chunks','app.search_index_state']) {
          assert.equal((await sql.unsafe(`select count(*)::int n from ${table} where owner_id=$1`,[owner]))[0].n,1);
        }
        for (const table of ['pgmq.q_search_index','pgmq.a_search_index']) {
          const rows = await sql.unsafe(`select message from ${table} where message->>'owner_id'=$1`,[owner]);
          assert.deepEqual(rows.map(r=>r.message.id),['keep']);
        }
        assert.equal((await sql`select count(*)::int n from private.request_results where owner_id=${owner}`)[0].n,4);
        const remaining=JSON.stringify(await sql`select result from private.request_results where owner_id=${owner}`);
        assert.ok(!remaining.includes('REMOVE-ME')); assert.ok(!remaining.includes('applied_principle_snapshots'));
        const [settings]=await sql`select settings,version from app.user_business_settings where owner_id=${owner}`;
        assert.deepEqual(settings.settings,{task:{create:{memo:'keep template'}}});assert.equal(settings.version,5);
        assert.deepEqual((await sql`select raw_user_meta_data from auth.users where id=${owner}`)[0].raw_user_meta_data,{nickname:'keep',workspace_navigation:{version:1,refs:[{kind:'builtin',id:'records'}]}});
        assert.equal((await sql`select body from app.tasks where owner_id=${owner}`)[0].body,'keep task');
        assert.equal((await sql`select properties from app.entities where owner_id=${owner}`)[0].properties.prop_1,'keep material');
      }
      await assert.rejects(()=>sql`select * from app.claim_search_index(1,null,'principle',null)`,e=>e.code==='22023');
      assert.equal((await sql`select * from app.claim_search_index(1,null,'task',null)`).length,0);
      await assert.rejects(()=>sql`insert into app.records(owner_id,id,body,record_kind,change_metadata) values(${owners[0]},'invalid','test','change','{"target_kind":"principle"}')`,e=>e.code==='23514');
    } finally {
      await sql?.end();
      if(created)await admin.unsafe(`drop database "${name}"`);
      await admin.end();
    }
  });
}
