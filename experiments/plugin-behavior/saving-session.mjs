import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { saveJournal } from './journal.mjs';
import { readBusinessOriginals } from './preparation.mjs';
import { verifyStoredChange, newSavingIntent } from './saving.mjs';

export async function openSavingTrial(fixture, fixturePath, mode) {
  if (!fixture.preparation || fixture.scenario !== 'normal' || !fixture.authCreated || fixture.authDeleted || fixture.ownerId !== fixture.authUserId || fixture.authEmail !== `${fixture.marker}@fixture.invalid`) throw new Error('Saving trials require a fresh journal-owned synthetic user');
  if (fixture.saving?.pending) throw new Error('Previous saving trial must be reconciled or cleaned first');
  const client = new Client({ name: 'save-independent', version: '0.1.0' });
  const call = async (name, input) => {
    const result = await client.callTool({ name, arguments: input });
    if (result.isError) throw new Error('Independent public business read failed; no payload logged');
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(fixture.endpoint), { requestInit: { headers: { Authorization: `Bearer ${fixture.token}` } } }));
    const before = await readBusinessOriginals(call);
    fixture.saving = newSavingIntent(fixture.saving, mode);
    if (mode === 'save-memo' && !before.records.some(row => row.id === fixture.saving.recordId && row.record_kind === 'result')) throw new Error('Memo trial requires this journal-owned saved task result');
    fixture.saving.pending = { mode, before }; await saveJournal(fixturePath, fixture);
    return {
      async finish() {
        const after = await readBusinessOriginals(call);
        const proof = verifyStoredChange(before, after, fixture, mode);
        const created = after.records.filter(row => !before.records.some(old => old.id === row.id));
        fixture.saving.ownedRecordIds = [...new Set([...fixture.saving.ownedRecordIds, ...created.map(row => row.id)])];
        if (mode === 'save-task' && proof.taskCompleted) fixture.saving.recordId = proof.recordId;
        delete fixture.saving.pending; await saveJournal(fixturePath, fixture);
        return proof;
      },
      close: () => client.close(),
    };
  } catch (error) { await client.close(); throw error; }
}

// Reconcile a killed native trial before ordinary fixture cleanup. Only this
// synthetic user's new records or previously journaled trial IDs may be removed.
export async function cleanupSavingRecords(fixture, save, call) {
  if (!fixture.saving) return;
  if (!fixture.authCreated || fixture.ownerId !== fixture.authUserId || fixture.authEmail !== `${fixture.marker}@fixture.invalid`) throw new Error('Saving cleanup requires owned synthetic user');
  const state = await readBusinessOriginals(call);
  const created = fixture.saving.pending ? state.records.filter(row => !fixture.saving.pending.before.records.some(old => old.id === row.id)).map(row => row.id) : [];
  fixture.saving.ownedRecordIds = [...new Set([...fixture.saving.ownedRecordIds, ...created])]; await save();
  for (const id of fixture.saving.ownedRecordIds) {
    const record = state.records.find(row => row.id === id);
    if (record) await call('delete_record', { id, expected_version: record.version });
  }
  fixture.saving.ownedRecordIds = []; delete fixture.saving.pending; await save();
}
