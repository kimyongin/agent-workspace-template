import test from 'node:test';
import assert from 'node:assert/strict';
import { planCleanup, validateManifest } from './demo-cleanup.mjs';
const owner = '00000000-0000-4000-8000-000000000001';
const type = '00000000-0000-4000-8000-000000000002';
const manifest = { environment: { name: 'isolated-demo', host: '127.0.0.1', port: 57922, database: 'postgres' }, owner_id: owner, ids: { entities: ['demo:a'], tasks: [], records: ['r1'], tags: [], entity_types: [type] }, reset_template_paths: [] };
test('explicit demo scope includes dependent schema originals and queued record, preserves other owner', () => {
  const report = planCleanup(manifest, {
    'app.entities': [{ owner_id: owner, id: 'demo:a', entity_type_id: type }, { owner_id: 'other', id: 'demo:a', entity_type_id: type }],
    'app.records': [{ owner_id: owner, id: 'r1', entity_ids: ['demo:a'] }],
    'app.entity_types': [{ owner_id: owner, id: type }],
    'app.entity_schema_versions': [{ owner_id: owner, type_id: type, schema_version: 1 }],
    'app.entity_schema_migrations': [{ owner_id: owner, id: 'j1', type_id: type }],
    'private.entity_schema_migration_rows': [{ owner_id: owner, job_id: 'j1', entity_id: 'demo:a', source_properties: { prop_1: 'original' } }],
    'pgmq.q_search_index': [{ msg_id: '1', message: { owner_id: owner, id: 'r1', kind: 'record' } }, { msg_id: '2', message: { owner_id: 'other', id: 'r1', kind: 'record' } }],
  });
  assert.equal(report.counts['app.entities'], 1);
  assert.equal(report.counts['private.entity_schema_migration_rows'], 1);
  assert.equal(report.counts['pgmq.q_search_index'], 1);
  assert.deepEqual(report.blockers, []);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
});
test('rejects unapproved owner and empty or broad scope', () => {
  assert.throws(() => validateManifest({ ...manifest, owner_id: '*' }), /owner/);
  assert.throws(() => validateManifest({ ...manifest, ids: {} }), /ids/);
  assert.throws(() => validateManifest({ ...manifest, reset_template_paths: [['identity']] }), /template/);
});
test('unapproved live references and recovery originals block deletion instead of broadening scope', () => {
  const report = planCleanup(manifest, {
    'app.entities': [{ owner_id: owner, id: 'demo:a', entity_type_id: type }, { owner_id: owner, id: 'demo:b', entity_type_id: type }],
    'app.records': [{ owner_id: owner, id: 'r1' }, { owner_id: owner, id: 'personal', entity_context: [{ id: 'demo:a' }] }],
    'app.entity_types': [{ owner_id: owner, id: type }],
    'private.entity_schema_migration_rows': [{ owner_id: owner, job_id: 'unapproved-job', entity_id: 'demo:a' }],
    'app.entity_pairs': [{ owner_id: owner, entity_id: 'demo:a', other_id: 'demo:b' }],
  });
  assert.deepEqual(report.blockers.map(r => r.reason), ['unapproved_type_member', 'unapproved_business_reference', 'unapproved_recovery_reference', 'unapproved_pair_endpoint']);
});
test('only explicitly named legacy template action resets while identity and unrelated templates remain', () => {
  const settings = { entity: { create: { memo: '$엔터티.prop1$' }, update: { memo: 'keep' } }, task: { create: { memo: 'personal' } }, identity: { issuer: 'keep' } };
  const report = planCleanup({ ...manifest, ids: { entities: [], tasks: [], records: [], tags: [], entity_types: [] }, reset_template_paths: [['entity', 'create']] }, { 'app.user_business_settings': [{ owner_id: owner, id: 'record_templates', settings }] });
  assert.deepEqual(report.updatedSettings, { entity: { update: { memo: 'keep' } }, task: { create: { memo: 'personal' } }, identity: { issuer: 'keep' } });
  assert.equal(settings.entity.create.memo, '$엔터티.prop1$');
  assert.equal(JSON.stringify(report).includes('personal'), false);
});
test('environment mismatch is rejected before a database connection', async () => {
  const { assertEnvironment } = await import('./demo-cleanup.mjs');
  assert.doesNotThrow(() => assertEnvironment(manifest, 'postgres://admin:secret@127.0.0.1:57922/postgres'));
  assert.throws(() => assertEnvironment(manifest, 'postgres://admin:secret@127.0.0.1:54322/postgres'), /environment/);
  assert.throws(() => assertEnvironment(manifest, 'postgres://admin:secret@production:57922/postgres'), /environment/);
});
test('approval digest changes with originals even when counts remain equal, and ignores row order', () => {
  const base = { 'app.entities': [{ owner_id: owner, id: 'demo:a', properties: { prop_1: 'before' } }, { owner_id: owner, id: 'keep' }], 'app.records': [{ owner_id: owner, id: 'r1' }], 'app.entity_types': [{ owner_id: owner, id: type }] };
  const changed = structuredClone(base);
  changed['app.entities'][0].properties.prop_1 = 'after';
  assert.notEqual(planCleanup(manifest, base).digest, planCleanup(manifest, changed).digest);
  const reordered = structuredClone(base);
  reordered['app.entities'].reverse();
  assert.equal(planCleanup(manifest, base).digest, planCleanup(manifest, reordered).digest);
});
test('relations stored in another entity and other type schema are preserved by blocking cleanup', () => {
  const peerType = '00000000-0000-4000-8000-000000000003';
  const report = planCleanup(manifest, {
    'app.entities': [{ owner_id: owner, id: 'demo:a', entity_type_id: type }, { owner_id: owner, id: 'keep:a', entity_type_id: peerType, properties: { prop_7: ['demo:a'] } }],
    'app.records': [{ owner_id: owner, id: 'r1' }],
    'app.entity_types': [{ owner_id: owner, id: type }],
    'app.entity_schema_versions': [{ owner_id: owner, type_id: peerType, schema: { properties: { prop_7: { 'x-relation': { type_id: type } } } } }],
  });
  assert.deepEqual(report.blockers.map(b => b.reason), ['unapproved_entity_reference', 'unapproved_schema_reference']);
});
test('another type recovery snapshot cannot restore a deleted relation after cleanup', () => {
  const report = planCleanup(manifest, {
    'app.entities': [{ owner_id: owner, id: 'demo:a' }], 'app.records': [{ owner_id: owner, id: 'r1' }], 'app.entity_types': [{ owner_id: owner, id: type }],
    'private.entity_schema_migration_rows': [{ owner_id: owner, job_id: 'other-job', entity_id: 'keep:a', source_properties: { prop_7: ['demo:a'] } }],
  });
  assert.deepEqual(report.blockers.map(b => b.reason), ['unapproved_recovery_reference']);
});

test('explicit final type-action reset prunes only its now-empty type binding',()=>{
 const kept='00000000-0000-4000-8000-000000000003';
 const settings={entity_types:{[type]:{update:{memo:'owned'}},[kept]:{update:{memo:'keep'}}},task:{create:{memo:'personal'}}};
 const report=planCleanup({...manifest,ids:{entities:[],tasks:[],records:[],tags:[],entity_types:[type]},reset_template_paths:[['entity_types',type,'update']]},{'app.entity_types':[{owner_id:owner,id:type}],'app.user_business_settings':[{owner_id:owner,id:'record_templates',settings}]});
 assert.deepEqual(report.blockers,[]);assert.deepEqual(report.updatedSettings,{entity_types:{[kept]:{update:{memo:'keep'}}},task:{create:{memo:'personal'}}});
 assert.equal(settings.entity_types[type].update.memo,'owned');
});
