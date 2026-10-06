import { readFile, writeFile, lstat, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function assertJournal(journal, endpoint, clientName) {
  if (journal.journalVersion !== 1 || journal.endpoint !== endpoint || journal.clientName !== clientName ||
      !new RegExp(`^plugin-${clientName}-[a-f0-9]{8,12}$`).test(journal.marker)) throw new Error('Fixture journal ownership mismatch');
  for (const kind of ['tag', 'entity', 'principle', 'record', 'task']) {
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
    journal.pendingCreate = { kind, input: { ...input, id: randomUUID() } };
  }
  if (journal.pendingCreate.kind !== kind) throw new Error('Unresolved fixture creation step');
  await save(); // Durable identity/input before every attempt, including a retry after disk failure.
  let object;
  try { object = await call(`create_${kind}`, journal.pendingCreate.input); }
  catch (error) {
    if (error?.code !== "conflict" && !/conflict/.test(error?.message ?? "")) throw error;
    object = (await listAll(call, kind)).find(row => row.id === journal.pendingCreate.input.id);
    if (!object || !ownedName(journal, kind, object)) throw error;
  }
  if (!object?.id) throw new Error('Fixture create returned no ID');
  journal[kind] = object;
  delete journal.pendingCreate;
  await save(); // Each returned ID is persisted before the next mutation.
  return object;
}

const plurals = { tag: 'tags', entity: 'entities', principle: 'principles', record: 'records', task: 'tasks' };
function ownedName(journal, kind, object) {
  return kind === 'tag' ? object.name === journal.marker : kind === 'entity' ? object.prop1 === journal.marker :
    object.title === `${journal.marker}-${kind === 'record' ? 'source' : kind}`;
}
async function listPageSet(call, kind) {
  if (kind === 'principle') { const { current } = await call('get_current_principle', {}); return current ? [current] : []; }
  const all = [], seen = new Set();
  let cursor;
  do {
    const page = await call(`list_${plurals[kind]}`, { ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.items)) throw new Error('Unexpected fixture list response');
    all.push(...page.items);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Fixture cleanup cursor repeated');
    seen.add(cursor);
  } while (cursor);
  return all;
}
async function listAll(call, kind) {
  return listPageSet(call, kind);
}

export async function setupOwned(journal, save, call, listTools) {
  const { marker, originalDetail } = journal;
  const { current } = await call('get_current_principle', {});
  const ownPending = journal.pendingCreate?.kind === 'principle' && current && ownedName(journal, 'principle', current);
  if (current && current.id !== journal.principle?.id && !ownPending) throw new Error('Fixture refuses existing current principle before writes');
  const tag = await createOwned(journal, save, call, 'tag', { name: marker });
  const entity = await createOwned(journal, save, call, 'entity', { prop1: marker, prop2: 7, prop3: '2026-10-04', prop4: 'b' });
  await createOwned(journal, save, call, 'principle', { title: `${marker}-principle`, summary: '검토에는 원문 검증 코드와 대상 속성을 함께 기록한다.', body: '결과 기록에는 원문에서 읽은 검증 코드를 정확히 남기고 대상 속성 2의 현재 값도 함께 적는다.' });
  await createOwned(journal, save, call, 'record', { title: `${marker}-source`, summary: '이 fixture의 이전 검토 기록. 본문에 검증 코드가 있다.', body: `당시 확인한 원문 검증 코드는 ${originalDetail}이다. 대상 속성 2는 7이며 현재 원문과 원칙을 다시 비교한다.`, tag_ids: [tag.id], entity_ids: [entity.id] });
  const tools = (await listTools()).tools.map(({ name }) => name).sort();
  Object.assign(journal, { tools, state: 'ready' });
  await save();
  return tools;
}

export async function cleanupOwned(journal, save, call, deleteOAuth) {
  if (journal.state === 'cleaned') return;
  // Retry with the persisted object UUID; a conflict is reconciled by reading the owned fixture.
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
      if (!journal.entity || !full.entity_ids?.includes(journal.entity.id) || !full.tag_ids?.includes(journal.tag?.id)) throw new Error('Result ownership links differ; no deletion');
      await call('delete_record', { id: full.id, expected_version: full.version });
    }
  }
  journal.resultsCleaned = true;
  await save();
  for (const kind of ['record', 'task', 'principle', 'entity', 'tag']) {
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
