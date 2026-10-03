import { readFile, writeFile, lstat, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function assertJournal(journal, endpoint, clientName) {
  if (journal.journalVersion !== 1 || journal.endpoint !== endpoint || journal.clientName !== clientName ||
      !new RegExp(`^plugin-${clientName}-[a-f0-9]{8,12}$`).test(journal.marker)) throw new Error('Fixture journal ownership mismatch');
  for (const kind of ['tag', 'entity', 'principle', 'record']) {
    if (journal[kind] && !ownedName(journal, kind, journal[kind])) throw new Error('Fixture journal object identity mismatch');
  }
  if (journal.pendingCreate && (!Object.keys(plurals).includes(journal.pendingCreate.kind) || !ownedName(journal, journal.pendingCreate.kind, journal.pendingCreate.input))) throw new Error('Pending fixture identity mismatch');
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Only loopback journal endpoint allowed');
  if (journal.token) {
    const claims = JSON.parse(Buffer.from(journal.token.split('.')[1], 'base64url').toString());
    if (!claims.sub || claims.sub !== journal.ownerId || !claims.client_id || claims.client_id !== journal.oauthClientId) throw new Error('Fixture token owner/client mismatch');
  }
}

export async function saveJournal(path, journal, initial = false) {
  if (initial) return writeFile(path, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Journal must be a regular experiment file');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function readJournal(path, endpoint, clientName) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Journal must be a regular experiment file');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  assertJournal(journal, endpoint, clientName);
  return journal;
}

export async function createOwned(journal, save, call, kind, input) {
  if (journal[kind]) { await save(); return journal[kind]; }
  if (!journal.pendingCreate) {
    journal.pendingCreate = { kind, input: { ...input, request_id: randomUUID() } };
  }
  if (journal.pendingCreate.kind !== kind) throw new Error('Unresolved fixture creation step');
  await save(); // Durable identity/input before every attempt, including a retry after disk failure.
  const object = await call(`create_${kind}`, journal.pendingCreate.input);
  if (!object?.id) throw new Error('Fixture create returned no ID');
  journal[kind] = object;
  delete journal.pendingCreate;
  await save(); // Each returned ID is persisted before the next mutation.
  return object;
}

const plurals = { tag: 'tags', entity: 'entities', principle: 'principles', record: 'records' };
function ownedName(journal, kind, object) {
  return kind === 'tag' ? object.name === journal.marker : kind === 'entity' ? object.prop1 === journal.marker :
    object.title === `${journal.marker}-${kind === 'record' ? 'source' : 'principle'}`;
}
async function listAll(call, kind) {
  const all = [], seen = new Set();
  let cursor;
  do {
    const page = await call(`list_${plurals[kind]}`, { ...(kind === 'principle' ? { status: 'all' } : {}), ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.items)) throw new Error('Unexpected fixture list response');
    all.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Fixture cleanup cursor repeated');
    seen.add(cursor);
  } while (cursor);
  return all;
}

export async function cleanupOwned(journal, save, call, deleteOAuth) {
  if (journal.state === 'cleaned') return;
  // Lost create responses are reconciled with the exact persisted request_id.
  // This may create the intended fixture if the failed request never committed.
  if (journal.pendingCreate) {
    const { kind, input } = journal.pendingCreate;
    await createOwned(journal, save, call, kind, input);
  }
  journal.state = 'cleaning';
  journal.deleted ??= {};
  await save();
  if (!journal.resultsCleaned && (journal.record || journal.entity)) {
    const results = (await listAll(call, 'record')).filter((record) => record.title === `${journal.marker}-result`);
    for (const record of results) {
      const full = await call('get_record', { id: record.id });
      if (!journal.entity || full.entity_id !== journal.entity.id || !full.tag_ids?.includes(journal.tag?.id)) throw new Error('Result ownership links differ; no deletion');
      await call('delete_record', { id: full.id, expected_version: full.version });
    }
  }
  journal.resultsCleaned = true;
  await save();
  for (const kind of ['record', 'principle', 'entity', 'tag']) {
    const object = journal[kind];
    if (!object || journal.deleted[kind]) continue;
    const current = (await listAll(call, kind)).find(({ id }) => id === object.id);
    if (current) {
      if (!ownedName(journal, kind, current)) throw new Error('Fixture identity changed; no deletion');
      await call(`delete_${kind}`, { id: current.id, expected_version: current.version });
    } // Missing ID also handles a successful delete whose response/save was lost.
    journal.deleted[kind] = true;
    await save();
  }
  if (!journal.oauthDeleted && journal.oauthClientId) {
    await deleteOAuth(journal.oauthClientId);
    journal.oauthDeleted = true;
    await save();
  }
  journal.state = 'cleaned';
  delete journal.token;
  await save();
}
