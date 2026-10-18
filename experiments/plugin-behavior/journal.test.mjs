import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createOwned, cleanupOwned, setupOwned, saveJournal, readJournal, assertJournal } from './journal.mjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { entityCreate, entityListQuery } from '../../supabase/functions/_shared/contracts/entity.ts';
import { tagCreate, tagListQuery } from '../../supabase/functions/_shared/contracts/tag.ts';
import { recordListQuery } from '../../supabase/functions/_shared/contracts/record.ts';
import { taskCreate, taskListQuery } from '../../supabase/functions/_shared/contracts/task.ts';
import { requestKey } from '../../supabase/functions/_shared/contracts/request.ts';
// Journal v1 is historical owner-protocol evidence. Its retired record fixture
// shape is local to this mock test and is never exposed by current HTTP/MCP.
const historicalRecordInput = z.strictObject({ body: z.string().min(1).max(22000), tag_ids: z.array(z.string()).optional(), entity_ids: z.array(z.string()).optional() });
const creates = { tag: tagCreate, entity: entityCreate, record: historicalRecordInput, task: taskCreate };
const schemas = new Map(Object.entries(creates).map(([kind, contract]) => [`create_${kind}`, { parse(input) { const { request_key, ...body } = input; requestKey.parse(request_key); return { ...contract.parse(body), request_key }; } }]));
for (const [name, contract] of Object.entries({ list_entities: entityListQuery, list_tags: tagListQuery, list_records: recordListQuery, list_tasks: taskListQuery })) schemas.set(name, contract);
for (const kind of Object.keys(creates)) { schemas.set(`get_${kind}`, z.strictObject({ id: z.string() })); schemas.set(`delete_${kind}`, z.strictObject({ id: z.string(), expected_version: z.number(), request_key: requestKey.optional() })); }
const typeId = '00000000-0000-4000-8000-000000000001';
const scalarType = async () => ({ id: typeId, schema_version: 2, label: '검사 자료 test' });
const entityInput = marker => ({ entity_type_id: typeId, schema_version: 2, properties: { prop_1: marker, prop_2: 7, prop_3: '2026-10-04', prop_4: 'b' } });

const endpoint = 'http://127.0.0.1:55421/functions/v1/mcp';
function journal() {
  const claims = Buffer.from(JSON.stringify({ sub: 'own-owner', client_id: 'own-client' })).toString('base64url');
  return { journalVersion: 1, clientName: 'codex-cli', endpoint, marker: 'plugin-codex-cli-abcdef12', originalDetail: 'SOURCE-test', state: 'creating', ownerId: 'own-owner', oauthClientId: 'own-client', token: `mock.${claims}.mock` };
}
function service() {
  const rows = { tag: new Map(), entity: new Map(), record: new Map() };
  let fault, oauthAttempts = 0; const receipts = new Map();
  const calls = [], queries = [], inputs = [];
  return {
    rows, calls, queries, inputs, fail: (point) => { fault = point; },
    get oauthAttempts() { return oauthAttempts; },
    async oauth(id) { assert.equal(id, 'own-client'); oauthAttempts++; if (fault === 'oauth') { fault = undefined; throw new Error('lost auth response'); } },
    async call(name, input) {
      assert(schemas.has(name), `Actual MCP ToolDef missing: ${name}`);
      input = schemas.get(name).parse(input); // Real input contract before any mock effect.
      calls.push(name); inputs.push({ name, input: structuredClone(input) });
      const [verb, suffix] = name.split('_');
      const kind = suffix === 'entities' ? 'entity' : suffix.replace(/s$/, '');
      if (verb === 'create') {
        if (fault === `before:${kind}`) { fault = undefined; throw new Error('transport before commit'); }
        const key = input.request_key;
        if (receipts.has(key)) return structuredClone(receipts.get(key));
        const { request_key, ...body } = input;
        const object = { ...body, id: kind === 'entity' ? `app:${typeId}:${randomUUID()}` : randomUUID(), version: 1, ...(kind === 'entity' ? { title: input.properties.prop_1 } : {}) };
        receipts.set(key, structuredClone(object));
        rows[kind].set(object.id, object);
        if (fault === `after:${kind}`) { fault = undefined; throw new Error('lost create response'); }
        return object;
      }
      if (verb === 'list') {
        queries.push({ kind, ...input });
        const values = [...rows[kind].values()];
        const offset = input.cursor ? Number(input.cursor.split(':').at(-1)) : 0;
        if (input.cursor) assert(input.cursor.startsWith(`${kind}:${input.view ?? '-'}:`), 'Cursor must remain scoped to its view');
        return { items: values.slice(offset, offset + 1), next_cursor: offset + 1 < values.length ? `${kind}:${input.view ?? '-'}:${offset + 1}` : null };
      }
      if (verb === 'get') return rows[kind].get(input.id);
      if (verb === 'delete') {
        assert.equal(rows[kind].get(input.id)?.version, input.expected_version);
        rows[kind].delete(input.id);
        if (fault === `delete:${kind}`) { fault = undefined; throw new Error('lost delete response'); }
        return { deleted: input.id };
      }
      throw new Error('Unexpected mock operation');
    },
  };
}

for (const failure of ['before:entity', 'after:entity']) test(`partial setup ${failure} keeps durable token/tag/pending request and cleanup preserves foreign rows`, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'plugin-journal-'));
  const path = resolve(root, 'fixture.json');
  try {
    let data = journal();
    const api = service();
    const save = () => saveJournal(path, data);
    await saveJournal(path, data, true);
    const tag = await createOwned(data, save, api.call, 'tag', { name: data.marker });
    api.fail(failure);
    await assert.rejects(createOwned(data, save, api.call, 'entity', entityInput(data.marker)), /transport|lost/);
    data = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(data.tag.id, tag.id);
    assert.equal(data.token, journal().token);
    assert.equal(data.pendingCreate.kind, 'entity');
    assert.match(data.pendingCreate.input.request_key, /^[a-f0-9-]{36}$/);
    assert.equal('id' in data.pendingCreate.input, false);
    const pendingInput = structuredClone(data.pendingCreate.input);
    api.rows.tag.set('foreign', { id: 'foreign', name: 'unrelated', version: 3 });
    await cleanupOwned(data, save, api.call, api.oauth);
    assert.equal(api.rows.entity.size, 0);
    const attempts = api.inputs.filter(r => r.name === 'create_entity');
    assert.deepEqual(attempts.map(r => r.input), [pendingInput, pendingInput]);
    assert.notEqual(data.entity.id, pendingInput.request_key);
    assert.deepEqual([...api.rows.tag.keys()], ['foreign']);
    const cleaned = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(cleaned.state, 'cleaned');
    assert.equal(cleaned.token, undefined);
    assert.equal(api.oauthAttempts, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('lost delete and OAuth responses resume from persisted progress without repeating foreign/business writes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'plugin-journal-'));
  const path = resolve(root, 'fixture.json');
  try {
    let data = journal();
    const api = service(), save = () => saveJournal(path, data);
    await saveJournal(path, data, true);
    await createOwned(data, save, api.call, 'tag', { name: data.marker });
    api.fail('delete:tag');
    await assert.rejects(cleanupOwned(data, save, api.call, api.oauth), /lost delete/);
    data = await readJournal(path, endpoint, 'codex-cli');
    api.fail('oauth');
    await assert.rejects(cleanupOwned(data, save, api.call, api.oauth), /lost auth/);
    data = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(data.deleted.tag, true);
    const businessCalls = api.calls.length;
    await cleanupOwned(data, save, api.call, api.oauth);
    assert.equal(api.calls.length, businessCalls);
    assert.equal(api.calls.filter((name) => name === 'delete_tag').length, 1);
    assert.equal(api.oauthAttempts, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('journal write failure stops mutation; existing journals and owner/endpoint/object drift are rejected', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'plugin-journal-'));
  const path = resolve(root, 'fixture.json');
  try {
    const data = journal(), api = service();
    await assert.rejects(createOwned(data, async () => { throw new Error('disk fault'); }, api.call, 'tag', { name: data.marker }), /disk fault/);
    assert.equal(api.calls.length, 0);
    await assert.rejects(createOwned(data, async () => { throw new Error('disk fault'); }, api.call, 'tag', { name: data.marker }), /disk fault/);
    assert.equal(api.calls.length, 0);
    await saveJournal(path, journal(), true);
    const original = await readFile(path, 'utf8');
    await assert.rejects(saveJournal(path, data, true), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), original);
    assert.throws(() => assertJournal(journal(), 'http://127.0.0.1:9999/functions/v1/mcp', 'codex-cli'), /ownership/);
    assert.throws(() => assertJournal({ ...journal(), ownerId: 'other' }, endpoint, 'codex-cli'), /owner/);
    assert.throws(() => assertJournal({ ...journal(), tag: { id: 'foreign', name: 'unrelated' } }, endpoint, 'codex-cli'), /identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inventory failure after all three creates leaves every ID available for partial cleanup', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'plugin-journal-'));
  const path = resolve(root, 'fixture.json');
  try {
    let data = journal();
    const api = service(), save = () => saveJournal(path, data);
    await saveJournal(path, data, true);
    let inventoryCalls = 0;
    await assert.rejects(setupOwned(data, save, api.call, async () => {
      inventoryCalls++;
      const persisted = await readJournal(path, endpoint, 'codex-cli');
      for (const kind of ['tag', 'entity', 'record']) assert.equal(persisted[kind].id, data[kind].id);
      throw new Error('listTools transport failure');
    }, scalarType), /listTools/);
    assert.equal(inventoryCalls, 1);
    data = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(data.state, 'creating');
    await cleanupOwned(data, save, api.call, api.oauth);
    assert(Object.values(api.rows).every((rows) => rows.size === 0));
    assert.equal(data.state, 'cleaned');
  } finally { await rm(root, { recursive: true, force: true }); }
});
