// Root runs this only against its owned, isolated local DB. Never an operational reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { assertEnvironment, runCleanup } from './demo-cleanup.mjs';

test('administrator cleanup preserves accounts, settings and another owner; stale queue cannot resurrect a record', async () => {
  const databaseUrl = process.env.LOCAL_DB_URL;
  assert.ok(databaseUrl, 'LOCAL_DB_URL required');
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'isolated local DB only');
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice() {} });
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), type = crypto.randomUUID(), otherType = crypto.randomUUID();
  const record = `cleanup-${crypto.randomUUID()}`, personal = `keep-${crypto.randomUUID()}`, task = `task-${crypto.randomUUID()}`;
  const tag = `tag-${crypto.randomUUID()}`, change = crypto.randomUUID(), analysis = crypto.randomUUID(), job = crypto.randomUUID();
  const settings = { entity: { create: { memo: '$엔터티.prop1$' }, update: { memo: 'keep' } }, task: { create: { memo: 'personal' } } };
  const manifest = { environment: { name: 'isolated-cleanup-test', host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)) }, owner_id: owner,
    ids: { entities: ['demo:a', 'demo:b'], tasks: [task], records: [record], tags: [tag], entity_types: [type] }, reset_template_paths: [['entity', 'create']] };
  assertEnvironment(manifest, databaseUrl);
  try {
    await sql.begin(async tx => {
      await tx`insert into auth.users(id,email) values(${owner},${`cleanup-${owner}@example.test`}),(${other},${`cleanup-${other}@example.test`})`;
      for (const [user, typeId] of [[owner, type], [other, otherType]]) {
        await tx`insert into app.entity_types(owner_id,id,label) values(${user},${typeId},'cleanup test')`;
        await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${user},${typeId},1,'{}','{}')`;
        await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${user},'demo:a','demo','a',${typeId},1,'{}')`;
      }
      await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${owner},'demo:b','demo','b',${type},1,'{}')`;
      await tx`insert into app.entity_pairs(owner_id,entity_id,other_id) values(${owner},'demo:a','demo:b')`;
      await tx`insert into app.tasks(owner_id,id,kind,title,body,status,entity_ids) values(${owner},${task},'once','approved task','demo','open',array['demo:a'])`;
      await tx`insert into app.tags(owner_id,id,name,scope) values(${owner},${tag},'approved tag','record')`;
      await tx`insert into app.records(owner_id,id,body) values(${owner},${record},'approved demo'),(${owner},${personal},'personal keep')`;
      await tx`update app.records set task_id=${task},entity_ids=array['demo:a'] where owner_id=${owner} and id=${record}`;
      await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${owner},${record},${tag})`;
      await tx`insert into app.entity_schema_changes(owner_id,type_id,id,source_type_version,source_schema_version,source_template_fingerprint,kind,edits,reservations,target,diff,fingerprint) values(${owner},${type},${change},1,1,'test','migration_required','[]','[]','{"schema":{},"display":{}}','{}','test')`;
      await tx`insert into app.entity_schema_analyses(owner_id,type_id,change_id,id,change_version,fingerprint,membership,status,total) values(${owner},${type},${change},${analysis},1,'test','test','succeeded',1)`;
      await tx`insert into private.entity_schema_analysis_rows(owner_id,analysis_id,entity_id,source_version,source_schema_version,properties) values(${owner},${analysis},'demo:a',1,1,'{"prop_1":"original"}')`;
      await tx`insert into app.entity_schema_migrations(owner_id,type_id,id,change_id,change_version,analysis_id,fingerprint,membership,source_type_version,source_schema_version,source_template_fingerprint,source_templates,source_definition,target,migration,status,total,actor_source,source_expires_at) values(${owner},${type},${job},${change},1,${analysis},'test','test',1,1,'test','{}','{}','{}','{}','succeeded',1,'http',now()+interval '30 days')`;
      await tx`insert into private.entity_schema_migration_rows(owner_id,job_id,entity_id,source_version,source_schema_version,source_properties,source_identity,after,changed) values(${owner},${job},'demo:a',1,1,'{"prop_1":"original"}','{}','{}',false)`;
      await tx`insert into app.user_business_settings(owner_id,id,version,settings) values(${owner},'record_templates',1,${tx.json(settings)}),(${owner},'entity_identity',1,'{"default_source":"personal"}')`;
      await tx`select pgmq.send('search_index',${tx.json({ owner_id: owner, kind: 'record', id: record, pipeline: 'test', input_hash: '0'.repeat(64) })})`;
      await tx`insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline) values(${owner},'record',${record},${'0'.repeat(64)},'test')`;
      await tx`insert into private.passage_effects(owner_id,record_id,source_version,source_hash,pipeline,provider_scope,model,dimensions,start_offset,end_offset,input_hash) values(${owner},${record},1,${'0'.repeat(64)},'test',${'1'.repeat(64)},'test',1024,0,2,${'2'.repeat(64)})`;
      const [archived] = await tx`select pgmq.send('search_index',${tx.json({owner_id: owner,kind: 'record',id: record})}) message`;
      await tx`select pgmq.archive('search_index',${archived.message})`;
    });
    const before = await runCleanup(sql, manifest);
    assert.equal(before.mode, 'dry-run');
    assert.deepEqual(before.blockers, []);
    assert.equal(before.counts['app.entities'], 2);
    assert.equal(before.counts['app.entity_pairs'], 1);
    assert.equal(before.counts['private.passage_effects'], 1);
    assert.equal(before.counts['private.entity_schema_migration_rows'], 1);
    assert.equal(before.counts['private.entity_schema_analysis_rows'], 1);
    assert.equal(before.counts['pgmq.a_search_index'], 1);
    assert.equal(before.counts['app.record_tags'], 1);
    assert.equal(before.counts['app.tasks'], 1);
    assert.equal((await sql`select count(*)::int n from app.records where owner_id=${owner}`)[0].n, 2);
    await assert.rejects(runCleanup(sql, manifest, '0'.repeat(64)), /digest/);
    const applied = await runCleanup(sql, manifest, before.digest);
    assert.equal(applied.residual_rows, 0);
    assert.equal((await sql`select count(*)::int n from private.entity_schema_migration_rows where job_id=${job}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from app.entity_schema_migrations where id=${job}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from private.entity_schema_analysis_rows where analysis_id=${analysis}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from private.passage_effects where owner_id=${owner} and record_id=${record}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from auth.users where id in (${owner},${other})`)[0].n, 2);
    assert.equal((await sql`select count(*)::int n from app.entities where owner_id=${other} and id='demo:a'`)[0].n, 1);
    assert.equal((await sql`select body from app.records where owner_id=${owner} and id=${personal}`)[0].body, 'personal keep');
    const saved = await sql`select id,settings from app.user_business_settings where owner_id=${owner}`;
    assert.deepEqual(saved.find(r => r.id === 'record_templates').settings, { entity: { update: { memo: 'keep' } }, task: { create: { memo: 'personal' } } });
    assert.deepEqual(saved.find(r => r.id === 'entity_identity').settings, { default_source: 'personal' });
    const [stale] = await sql`select pgmq.send('search_index',${sql.json({ owner_id: owner, kind: 'record', id: record, pipeline: 'test', input_hash: '0'.repeat(64) })}) message`;
    assert.equal((await sql`select app.prepare_search_index(${stale.message},'test') result`)[0].result, null);
    assert.equal((await sql`select count(*)::int n from app.records where owner_id=${owner} and id=${record}`)[0].n, 0);
    assert.equal((await sql`select count(*)::int n from app.search_index_state where owner_id=${owner} and id=${record}`)[0].n, 0);
  } finally {
    await sql`delete from pgmq.q_search_index where message->>'owner_id' in (${owner},${other})`;
    await sql`delete from pgmq.a_search_index where message->>'owner_id' in (${owner},${other})`;
    await sql`delete from auth.users where id in (${owner},${other})`;
    await sql.end();
  }
});
