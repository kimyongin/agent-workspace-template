import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoundtripProfile, cleanupRoundtrip } from './roundtrip-session.mjs';

const empty = () => ({ current: { current: null }, entities: [], tasks: [], records: [], principles: [], tags: [] });
const own = () => ({ marker: 'plugin-codex-cli-12345678', authCreated: true, ownerId: 'owner', authUserId: 'owner', authEmail: 'plugin-codex-cli-12345678@fixture.invalid' });
function reader(state) {
  return async name => {
    if (name === 'get_current_principle') return state.current;
    if (name.startsWith('list_')) return { items: state[name.slice(5)].map(({ id }) => ({ id })), next_cursor: null };
    if (name.startsWith('get_')) return state[name === 'get_entity' ? 'entities' : name.slice(4) + 's'][0];
    throw new Error('Auth-only profile must never mutate business data');
  };
}
test('Auth-only profile reads the full empty public inventory, supplies real catalog and performs no SDK business bootstrap', async () => {
  const f = own(); let persisted;
  await prepareRoundtripProfile(f, async () => { persisted = structuredClone(f); }, reader(empty()), async () => ({ tools: [{ name: 'get_record' }, { name: 'create_task' }] }));
  assert.equal(persisted.preparation, false); assert.equal(persisted.state, 'ready');
  assert.deepEqual(persisted.tools, ['get_record', 'create_task']); assert.deepEqual(persisted.roundtrip.baseline, empty());
  await assert.rejects(prepareRoundtripProfile(own(), async () => {}, reader({ ...empty(), entities: [{ id: 'existing' }] }), async () => ({ tools: [] })), /not empty/);
});
test('lost phase cleanup saves new originals and intent before deleting, journals generated events and terminates', async () => {
  const f = { ...own(), roundtrip: { baseline: empty(), owned: {}, completed: [], pending: { mode: 'web-source', before: empty() } } };
  const state = { ...empty(), records: [{ id: 'r', record_kind: 'user', version: 1 }] };
  let persisted; let writes = 0;
  const call = async (name, input) => {
    if (name === 'delete_record') {
      assert.equal(persisted.roundtrip.cleanupIntent.id, input.id);
      assert.equal(persisted.roundtrip.cleanupIntent.before.records[0].id, 'r');
      assert.ok(persisted.roundtrip.owned.records.includes(input.id));
      state.records = [{ id: 'cleanup-event', record_kind: 'change', version: 1 }]; writes++; return;
    }
    return reader(state)(name);
  };
  await cleanupRoundtrip(f, async () => { persisted = structuredClone(f); }, call);
  assert.equal(writes, 1); assert.ok(f.roundtrip.owned.records.includes('cleanup-event'));
  assert.equal(f.roundtrip.pending, undefined);
  await assert.rejects(cleanupRoundtrip({ ...f, ownerId: 'foreign' }, async () => {}, call), /owned/);
  assert.equal(writes, 1);
});
