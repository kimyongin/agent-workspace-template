import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createOwned, cleanupOwned, setupOwned, saveJournal, readJournal, assertJournal } from './journal.mjs';
import { randomUUID } from 'node:crypto';
import { activityTools } from '../../supabase/functions/_shared/adapters/mcp/activity-tools.ts';
import { entityTools } from '../../supabase/functions/_shared/adapters/mcp/entity-tools.ts';
import { principleTools } from '../../supabase/functions/_shared/adapters/mcp/principle-tools.ts';
import { tagTools } from '../../supabase/functions/_shared/adapters/mcp/tag-tools.ts';

const schemas = new Map([...activityTools({}), ...entityTools({}), ...principleTools({}), ...tagTools({})].map(({ name, input }) => [name, input]));

const endpoint = 'http://127.0.0.1:55421/functions/v1/mcp';
function journal() {
  const claims = Buffer.from(JSON.stringify({ sub: 'own-owner', client_id: 'own-client' })).toString('base64url');
  return { journalVersion: 1, clientName: 'codex-cli', endpoint, marker: 'plugin-codex-cli-abcdef12', originalDetail: 'SOURCE-test', state: 'creating', ownerId: 'own-owner', oauthClientId: 'own-client', token: `mock.${claims}.mock` };
}
function service() {
  const rows = { tag: new Map(), entity: new Map(), principle: new Map(), record: new Map() }, requests = new Map();
  let fault, oauthAttempts = 0;
  const calls = [], queries = [];
  return {
    rows, calls, queries, fail: (point) => { fault = point; },
    get oauthAttempts() { return oauthAttempts; },
    async oauth(id) { assert.equal(id, 'own-client'); oauthAttempts++; if (fault === 'oauth') { fault = undefined; throw new Error('lost auth response'); } },
    async call(name, input) {
      assert(schemas.has(name), `Actual MCP ToolDef missing: ${name}`);
      input = schemas.get(name).parse(input); // Real input contract before any mock effect.
      calls.push(name);
      if (name === 'get_current_principle') return { current: [...rows.principle.values()].find(row => row.is_current) ?? null };
      const [verb, suffix] = name.split('_');
      const kind = suffix === 'entities' ? 'entity' : suffix.replace(/s$/, '');
      if (verb === 'create') {
        if (fault === `before:${kind}`) { fault = undefined; throw new Error('transport before commit'); }
        let object = requests.get(input.request_id);
        if (!object) {
          object = { ...input, id: randomUUID(), version: 1, ...(kind === 'principle' ? { status: 'active', is_current: true } : {}) };
          rows[kind].set(object.id, object); requests.set(input.request_id, object);
        }
        if (fault === `after:${kind}`) { fault = undefined; throw new Error('lost create response'); }
        return object;
      }
      if (verb === 'list') {
        queries.push({ kind, ...input });
        const values = [...rows[kind].values()].filter((value) => kind !== 'principle' || input.view === 'all' || (input.view === 'history' ? !value.is_current : value.is_current));
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
    await assert.rejects(createOwned(data, save, api.call, 'entity', { prop1: data.marker }), /transport|lost/);
    data = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(data.tag.id, tag.id);
    assert.equal(data.token, journal().token);
    assert.equal(data.pendingCreate.kind, 'entity');
    assert.match(data.pendingCreate.input.request_id, /^[a-f0-9-]{36}$/);
    api.rows.tag.set('foreign', { id: 'foreign', name: 'unrelated', version: 3 });
    await cleanupOwned(data, save, api.call, api.oauth);
    assert.equal(api.rows.entity.size, 0);
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

test('inventory failure after all four creates leaves every ID available for partial cleanup', async () => {
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
      for (const kind of ['tag', 'entity', 'principle', 'record']) assert.equal(persisted[kind].id, data[kind].id);
      throw new Error('listTools transport failure');
    }), /listTools/);
    assert.equal(inventoryCalls, 1);
    data = await readJournal(path, endpoint, 'codex-cli');
    assert.equal(data.state, 'creating');
    await cleanupOwned(data, save, api.call, api.oauth);
    assert(Object.values(api.rows).every((rows) => rows.size === 0));
    assert.equal(data.state, 'cleaned');
    assert.equal(api.queries.filter(({ kind }) => kind === 'principle').length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const ownStatus of ['active', 'inactive']) test(`actual ToolDef rejects retired status; cleanup finds own ${ownStatus} principle across paged all view`, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'plugin-journal-'));
  const path = resolve(root, 'fixture.json');
  try {
    const data = journal(), api = service(), save = () => saveJournal(path, data);
    await saveJournal(path, data, true);
    for (const status of ['active', 'inactive']) for (let index = 0; index < 2; index++) {
      const id = randomUUID();
      api.rows.principle.set(id, { id, title: `foreign-${status}-${index}`, status, version: 9 });
    }
    await setupOwned(data, save, api.call, async () => ({ tools: [...schemas.keys()].map((name) => ({ name })) }));
    api.rows.principle.get(data.principle.id).status = ownStatus;
    await assert.rejects(api.call('list_principles', { status: 'all' }), (error) => error.issues?.some(({ code }) => code === 'unrecognized_keys'));
    assert.equal(api.oauthAttempts, 0);
    assert(data.token);
    await cleanupOwned(data, save, api.call, api.oauth);
    assert.equal(api.rows.principle.size, 4);
    assert(!api.rows.principle.has(data.principle.id));
    const pages = api.queries.filter((query) => query.kind === 'principle');
    assert(pages.length >= 2);
    assert.equal(pages[0].cursor, undefined);
    assert(pages.slice(1).every(({ cursor }) => cursor.startsWith('principle:all:')));
    assert.equal(api.oauthAttempts, 1);
    assert.equal((await readJournal(path, endpoint, 'codex-cli')).token, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('setup refuses an existing foreign current principle before any fixture mutation', async () => {
  const data = journal(), api = service();
  const id = randomUUID(); api.rows.principle.set(id, { id, title: 'existing current', is_current: true, version: 9 });
  await assert.rejects(setupOwned(data, async () => {}, api.call, async () => ({ tools: [] })), /existing current/);
  assert.deepEqual(api.calls, ['get_current_principle']);
  assert.equal(api.rows.principle.get(id).version, 9);
  assert.equal(api.rows.tag.size + api.rows.entity.size + api.rows.record.size, 0);
});
