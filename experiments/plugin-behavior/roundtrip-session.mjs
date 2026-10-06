import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { saveJournal } from './journal.mjs';
import { readBusinessOriginals } from './preparation.mjs';
import { beginRoundtripPhase, finishRoundtripPhase, emptyRoundtrip } from './roundtrip.mjs';

export function assertRoundtripOwner(f) {
  if (!f.roundtrip || !f.authCreated || f.authDeleted || f.ownerId !== f.authUserId || f.authEmail !== `${f.marker}@fixture.invalid` || !emptyRoundtrip(f.roundtrip.baseline)) throw new Error('Roundtrip requires journal-owned fresh user and empty business baseline');
}
export async function prepareRoundtripProfile(f, save, call, listTools) {
  if (!f.authCreated || f.authDeleted || f.ownerId !== f.authUserId || f.authEmail !== `${f.marker}@fixture.invalid`) throw new Error('Roundtrip profile needs its synthetic Auth owner');
  const baseline = await readBusinessOriginals(call);
  if (!emptyRoundtrip(baseline)) throw new Error('Fresh roundtrip user is not empty');
  f.roundtrip = { baseline, owned: {}, completed: [] };
  f.scenario = 'normal'; f.preparation = false;
  f.tools = (await listTools()).tools.map(t => t.name);
  f.state = 'ready'; await save();
}
export async function connectRoundtrip(f) {
  assertRoundtripOwner(f);
  const client = new Client({ name: 'roundtrip-independent', version: '0.1.0' });
  try { await client.connect(new StreamableHTTPClientTransport(new URL(f.endpoint), { requestInit: { headers: { Authorization: `Bearer ${f.token}` } } })); }
  catch (error) { await client.close(); throw error; }
  return { client, call: async (name, input) => {
    const response = await client.callTool({ name, arguments: input });
    if (response.isError) throw new Error('Independent roundtrip public call failed; no payload logged');
    return response.structuredContent ?? JSON.parse(response.content[0].text);
  } };
}
export async function openRoundtripTrial(f, path, mode) {
  const { client, call } = await connectRoundtrip(f), save = () => saveJournal(path, f);
  try {
    await beginRoundtripPhase(f, save, await readBusinessOriginals(call), mode, f.roundtrip.intent);
    return { async finish() {
      const after = await readBusinessOriginals(call);
      const proof = await finishRoundtripPhase(f, save, after);
      if (proof.pass && mode === 'roundtrip-task') { f.task = after.tasks.find(t => t.id === proof.targetId); await save(); }
      if (proof.pass && mode === 'roundtrip-entity') { f.entity = after.entities.find(t => t.id === f.entity.id); await save(); }
      return proof;
    }, close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}

// Only the new synthetic owner, its empty baseline, and durable pre-phase originals.
// Cleanup-generated change records are removed by final own Auth-user cascade,
// not an endless delete-record/log loop or an administrator-wide inventory sweep.
export async function cleanupRoundtrip(f, save, call) {
  assertRoundtripOwner(f);
  let state = await readBusinessOriginals(call);
  const baseline = f.roundtrip.pending?.before ?? f.roundtrip.baseline;
  for (const k of ['entities', 'tasks', 'records', 'principles', 'tags']) {
    f.roundtrip.owned[k] = [...new Set([...(f.roundtrip.owned[k] ?? []), ...state[k].filter(r => !baseline[k].some(b => b.id === r.id)).map(r => r.id)])];
    if (state[k].some(r => !f.roundtrip.owned[k].includes(r.id))) throw new Error('Roundtrip cleanup encountered unjournaled original');
  }
  f.state = 'cleaning'; await save();
  for (const [kind, plural] of [['task', 'tasks'], ['principle', 'principles'], ['entity', 'entities'], ['record', 'records'], ['tag', 'tags']]) {
    state = await readBusinessOriginals(call);
    for (const id of f.roundtrip.owned[plural]) {
      const row = state[plural].find(r => r.id === id);
      if (!row) continue;
      f.roundtrip.cleanupIntent = { kind, id, expected_version: row.version, before: state }; await save();
      await call(`delete_${kind}`, { id, expected_version: row.version });
      const after = await readBusinessOriginals(call);
      for (const k of ['entities', 'tasks', 'records', 'principles', 'tags']) f.roundtrip.owned[k] = [...new Set([...f.roundtrip.owned[k], ...after[k].filter(r => !state[k].some(old => old.id === r.id)).map(r => r.id)])];
      // Do not append while iterating the deletion set: generated cleanup events
      // are journaled for Auth cascade, rather than recursively generating logs.
      await save();
    }
  }
  delete f.roundtrip.cleanupIntent; delete f.roundtrip.pending; await save();
}
