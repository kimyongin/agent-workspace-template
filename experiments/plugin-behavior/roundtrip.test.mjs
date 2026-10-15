import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoundtrip, beginRoundtripPhase, finishRoundtripPhase, hasRoundtripTaskOriginal, assessRoundtripNative, roundtripAnswerProof } from './roundtrip.mjs';

const empty = () => ({ entities: [], tasks: [], records: [], tags: [] });
const f = { marker: 'plugin-codex-cli-12345678', entity: { id: 'e', title: 'plugin-codex-cli-12345678', properties: { prop_1: 'plugin-codex-cli-12345678', prop_2: 7, prop_3: '2026-10-06', prop_4: 'b' }, version: 1 }, roundtrip: { intent: { id: 'e', memoBody: 'final memo' } } };
const event = (target, kind, action, source = 'http') => ({ id: 'c', record_kind: 'change', title: 'change', body: 'final memo', version: 1, entity_ids: kind === 'entity' ? ['e'] : [], change: { event_id: 'evt', target_kind: kind, target_id: target, target_title: kind === 'entity' ? f.marker : `${f.marker}-task`, action, source, path: `/${kind === 'entity' ? 'entities' : kind + 's'}/${target}`, before: null, after: null } });
test('entity update preserves scalar identity and requires the actual final memo event, with no extra writes', () => {
  const before = { ...empty(), entities: [f.entity] };
  const after = { ...empty(), entities: [{ ...f.entity, properties: { ...f.entity.properties, prop_2: 11 }, version: 2 }], records: [event('e', 'entity', 'update', 'mcp')] };
  assert.equal(verifyRoundtrip(before, after, f, 'roundtrip-entity').pass, true);
  assert.equal(verifyRoundtrip(before, { ...after, entities: [{ ...after.entities[0], properties: { ...after.entities[0].properties, prop_4: 'a' } }] }, f, 'roundtrip-entity').pass, false);
  assert.equal(verifyRoundtrip(before, { ...after, records: [...after.records, { ...after.records[0], id: 'extra' }] }, f, 'roundtrip-entity').pass, false);
  assert.equal(verifyRoundtrip(before, { ...after, records: [{ ...after.records[0], body: '' }] }, f, 'roundtrip-entity').pass, false);
});
test('real completion DTO keeps timestamps independent, result body exact, and memo edit adds no log', () => {
  const at = '2026-10-05T20:58:48.277Z', now = '2026-10-05T20:58:48.293Z';
  const task = { id: 't', kind: 'once', title: f.marker + '-task', body: '内容', entity_ids: ['e'], version: 1, status: 'open', completed_at: null, result_record_id: null, result_record: null, updated_at: at };
  const result = { id: 'r', record_kind: 'result', title: '확인 완료', body: '11 확인', entity_ids: ['e'], task_id: 't', version: 1, occurred_at: at, updated_at: now };
  const done = { ...task, version: 2, status: 'done', completed_at: now, updated_at: now, result_record_id: 'r', result_record: { id: 'r', body: '11 확인' } };
  const before = { ...empty(), entities: [f.entity], tasks: [task] }, after = { ...before, tasks: [done], records: [result] };
  const fixture = { ...f, task, roundtrip: { intent: { id: 't', body: result.body } } };
  assert.equal(verifyRoundtrip(before, after, fixture, 'web-complete').pass, true);
  assert.equal(verifyRoundtrip(before, { ...after, tasks: [{ ...done, result_record_id: 'foreign' }] }, fixture, 'web-complete').pass, false);
  const edited = { ...after, tasks: [{ ...done, result_record: { id: 'r', body: '정정' } }], records: [{ ...result, body: '정정', version: 2 }] };
  fixture.roundtrip.intent = { id: 'r', body: '정정' };
  assert.equal(verifyRoundtrip(after, edited, fixture, 'web-memo').pass, true);
  assert.equal(verifyRoundtrip(after, { ...edited, records: [{ ...edited.records[0], occurred_at: now }] }, fixture, 'web-memo').pass, false);
  assert.equal(verifyRoundtrip(after, { ...edited, records: [...edited.records, event('r', 'record', 'update')] }, fixture, 'web-memo').pass, false);
});

test('native task originals require full exact current DTO; a search result or stale version is insufficient', () => {
  const task = { id: 't', body: 'task body', status: 'done', version: 2, result_record_id: 'r', result_record: { id: 'r', body: 'result' } };
  assert.equal(hasRoundtripTaskOriginal('get_task', { structuredContent: task }, task), true);
  assert.equal(hasRoundtripTaskOriginal('search', { structuredContent: task }, task), false);
  assert.equal(hasRoundtripTaskOriginal('get_task', { ...task, version: 1 }, task), false);
  const evidence = { mode: 'roundtrip-task-read', exitCode: 0, completedSkillRead: true, originalSourceRead: true, independent: { pass: true }, mutationCalls: 0 };
  assert.equal(assessRoundtripNative(evidence).pass, false);
  assert.equal(assessRoundtripNative({ ...evidence, completedTaskRead: true, answer: { roundtrip: { correct: true } } }).pass, true);
});

test('task answer reports done, exact result body and reopening IDs; an open-state answer cannot borrow result completion words', () => {
  const fixture = { ...f, task: { id: 'task-id' }, roundtrip: { result: { id: 'result-id', body: '속성2=11 확인 완료; RESULT-code' } } };
  const good = '할 일 task-id\n상태: done (완료)\n결과 기록 result-id\n본문: 속성2=11 확인 완료; RESULT-code';
  const wrong = '할 일 task-id\n상태: open (미완료)\n결과 기록 result-id\n본문: 속성2=11 확인 완료; RESULT-code';
  assert.equal(roundtripAnswerProof(good, fixture, 'roundtrip-task-read').correct, true);
  assert.equal(roundtripAnswerProof(wrong, fixture, 'roundtrip-task-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('RESULT-code', 'wrong'), fixture, 'roundtrip-task-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('result-id', 'wrong-id'), fixture, 'roundtrip-task-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('done (완료)', 'done 상태가 아닙니다'), fixture, 'roundtrip-task-read').correct, false);
  const indexUnconfirmed = good.replace('상태: done (완료)', '상태: done (완료)\n색인 완료는 확인하지 못했습니다.');
  assert.equal(roundtripAnswerProof(indexUnconfirmed, fixture, 'roundtrip-task-read').correct, true);
  const priorOpen = good.replace('상태: done (완료)', '이전 할 일 상태는 open (미완료)이었습니다.\n현재 할 일 상태: done (완료)');
  assert.equal(roundtripAnswerProof(priorOpen, fixture, 'roundtrip-task-read').correct, true);
  const currentOpen = good.replace('상태: done (완료)', '현재 할 일 상태: open (미완료)\n색인 완료는 확인하지 못했습니다.');
  assert.equal(roundtripAnswerProof(currentOpen, fixture, 'roundtrip-task-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('상태: done (완료)', '현재 할 일 상태: done이고 색인 완료는 확인하지 못했습니다.'), fixture, 'roundtrip-task-read').correct, true);
  assert.equal(roundtripAnswerProof(good.replace('상태: done (완료)', '이전 할 일 상태는 open이었지만 현재 할 일 상태는 done입니다.'), fixture, 'roundtrip-task-read').correct, true);
});
test('read-only phase detects a memo write even when a task still reports done', () => {
  const before = { ...empty(), tasks: [{ id: 't', status: 'done', version: 2 }], records: [{ id: 'r', body: 'old', version: 1 }] };
  assert.equal(verifyRoundtrip(before, structuredClone(before), f, 'roundtrip-task-read').pass, true);
  assert.equal(verifyRoundtrip(before, { ...before, records: [{ id: 'r', body: 'new', version: 2 }] }, f, 'roundtrip-task-read').pass, false);
});
test('phase intent is durable before work; a killed phase blocks replay and remembers even failed new IDs', async () => {
  const journal = { roundtrip: { baseline: empty(), owned: {}, completed: [] } };
  const saved = []; const save = async () => saved.push(structuredClone(journal));
  await beginRoundtripPhase(journal, save, empty(), 'web-entity', { properties: { prop_2: 7 } });
  assert.equal(saved[0].roundtrip.pending.mode, 'web-entity');
  await assert.rejects(beginRoundtripPhase(journal, save, empty(), 'web-entity', {}), /reconcile/);
  const after = { ...empty(), entities: [{ ...f.entity, title: 'unexpected', properties: { ...f.entity.properties, prop_1: 'unexpected' } }] };
  const proof = await finishRoundtripPhase(journal, save, after);
  assert.equal(proof.pass, false);
  assert.deepEqual(journal.roundtrip.owned.entities, ['e']);
  assert.ok(journal.roundtrip.pending);
});
test('tuple entity identity uses the encoded public event path without changing its raw target ID', () => {
  const entity = { ...f.entity, id: 'app:trial' };
  const before = { ...empty(), entities: [entity] };
  const changed = { ...entity, version: 2, properties: { ...entity.properties, prop_2: 11 } };
  const note = { ...event(entity.id, 'entity', 'update', 'mcp'), entity_ids: [entity.id], change: { ...event(entity.id, 'entity', 'update', 'mcp').change, path: '/entities/app%3Atrial' } };
  const fixture = { ...f, entity, roundtrip: { intent: { id: entity.id, memoBody: 'final memo' } } };
  assert.equal(verifyRoundtrip(before, { ...empty(), entities: [changed], records: [note] }, fixture, 'roundtrip-entity').pass, true);
});
