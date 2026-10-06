import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedUser, deleteOwnedUser } from './owned-auth.mjs';

test('lost synthetic creation response retains assigned identity and cleanup deletes only it', async () => {
  const journal = { marker: 'plugin-codex-cli-abcdef12' }, rows = new Set(['other-owner']);
  let persisted;
  const save = async () => { persisted = structuredClone(journal); };
  const admin = { auth: { admin: {
    createUser: async input => { assert.equal(persisted.authUserId, input.id); assert.equal(persisted.authEmail, input.email); rows.add(input.id); throw Error('response lost'); },
    deleteUser: async id => { assert.equal(id, persisted.authUserId); rows.delete(id); return { error: null }; },
  } } };
  await assert.rejects(createOwnedUser(journal, save, admin), /response lost/);
  await deleteOwnedUser(journal, save, admin);
  assert.deepEqual([...rows], ['other-owner']); assert.equal(persisted.authPassword, undefined); assert.equal(persisted.authDeleted, true);
});
test('journal failure stops synthetic identity mutation and ownership mismatch stops cleanup', async () => {
  let writes = 0;
  const admin = { auth: { admin: { createUser: async () => { writes++; }, deleteUser: async () => { writes++; } } } };
  await assert.rejects(createOwnedUser({ marker: 'plugin-codex-cli-abcdef12' }, async () => { throw Error('disk unavailable'); }, admin), /disk unavailable/);
  await assert.rejects(deleteOwnedUser({ marker: 'plugin-codex-cli-abcdef12', authUserId: 'other', authEmail: 'other@example.test' }, async () => {}, admin), /ownership/);
  assert.equal(writes, 0);
});
