import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoundtrip, beginRoundtripPhase, finishRoundtripPhase, hasRoundtripOriginal, assessRoundtripNative, roundtripAnswerProof } from './roundtrip.mjs';

const empty = () => ({ current: { current: null }, entities: [], tasks: [], records: [], principles: [], tags: [] });
const f = { marker: 'plugin-codex-cli-12345678', entity: { id: 'e', prop1: 'plugin-codex-cli-12345678', prop2: 7, prop3: '2026-10-06', prop4: 'b', version: 1 }, roundtrip: { intent: { id: 'e', memoBody: 'final memo' } } };
const event = (target, kind, action, source = 'http') => ({ id: 'c', record_kind: 'change', title: 'change', summary: 'summary', body: 'final memo', version: 1, entity_ids: kind === 'entity' ? ['e'] : [], change: { event_id: 'evt', target_kind: kind, target_id: target, target_title: kind === 'entity' ? f.marker : `${f.marker}-principle`, action, source, path: action === 'delete' ? null : `/${kind === 'entity' ? 'entities' : kind + 's'}/${target}`, before: null, after: null } });
test('entity update preserves scalar identity and requires the actual final memo event, with no extra writes', () => {
  const before = { ...empty(), entities: [f.entity] };
  const after = { ...empty(), entities: [{ ...f.entity, prop2: 11, version: 2 }], records: [event('e', 'entity', 'update', 'mcp')] };
  assert.equal(verifyRoundtrip(before, after, f, 'roundtrip-entity').pass, true);
  assert.equal(verifyRoundtrip(before, { ...after, entities: [{ ...after.entities[0], prop4: 'a' }] }, f, 'roundtrip-entity').pass, false);
  assert.equal(verifyRoundtrip(before, { ...after, records: [...after.records, { ...after.records[0], id: 'extra' }] }, f, 'roundtrip-entity').pass, false);
  assert.equal(verifyRoundtrip(before, { ...after, records: [{ ...after.records[0], body: '' }] }, f, 'roundtrip-entity').pass, false);
});
test('real completion DTO keeps timestamps independent, result links and summaries exact, and memo edit adds no log', () => {
  const at = '2026-10-05T20:58:48.277Z', now = '2026-10-05T20:58:48.293Z';
  const task = { id: 't', kind: 'once', title: f.marker + '-task', summary: '確認', body: '内容', entity_ids: ['e'], version: 1, status: 'open', completed_at: null, result_record_id: null, result_record: null, updated_at: at };
  const result = { id: 'r', record_kind: 'result', title: '확인 완료', summary: '결과 요약', body: '11 확인', entity_ids: ['e'], task_id: 't', version: 1, occurred_at: at, updated_at: now };
  const done = { ...task, version: 2, status: 'done', completed_at: now, updated_at: now, result_record_id: 'r', result_record: { id: 'r', title: result.title, summary: result.summary } };
  const before = { ...empty(), entities: [f.entity], tasks: [task] }, after = { ...before, tasks: [done], records: [result] };
  const fixture = { ...f, task, roundtrip: { intent: { id: 't', body: result.body } } };
  assert.equal(verifyRoundtrip(before, after, fixture, 'web-complete').pass, true);
  assert.equal(verifyRoundtrip(before, { ...after, tasks: [{ ...done, result_record_id: 'foreign' }] }, fixture, 'web-complete').pass, false);
  const edited = { ...after, records: [{ ...result, body: '정정', version: 2 }] };
  fixture.roundtrip.intent = { id: 'r', body: '정정' };
  assert.equal(verifyRoundtrip(after, edited, fixture, 'web-memo').pass, true);
  assert.equal(verifyRoundtrip(after, { ...edited, records: [{ ...edited.records[0], occurred_at: now }] }, fixture, 'web-memo').pass, false);
  assert.equal(verifyRoundtrip(after, { ...edited, records: [...edited.records, event('r', 'record', 'update')] }, fixture, 'web-memo').pass, false);
});
test('current principle is same ID, saved_at advances, and deletion cannot promote another source', () => {
  const old = { id: 'p', title: f.marker + '-principle', summary: '현재', body: '7 보류', is_current: true, status: 'active', version: 1, saved_at: '2026-10-05T20:58:48.277Z' };
  const updated = { ...old, body: '11 진행', version: 2, saved_at: '2026-10-05T20:58:49.293Z' };
  const before = { ...empty(), principles: [old], current: { current: old } };
  const after = { ...before, principles: [updated], current: { current: updated }, records: [event('p', 'principle', 'update')] };
  const fixture = { ...f, principle: old, roundtrip: { intent: { id: 'p', body: updated.body } } };
  assert.equal(verifyRoundtrip(before, after, fixture, 'web-principle-update').pass, true);
  assert.equal(verifyRoundtrip(before, { ...after, current: { current: old } }, fixture, 'web-principle-update').pass, false);
  fixture.roundtrip.intent = { id: 'p' };
  const deleted = { ...after, principles: [], current: { current: null }, records: [...after.records, { ...event('p', 'principle', 'delete'), id: 'deletion' }] };
  assert.equal(verifyRoundtrip(after, deleted, fixture, 'web-principle-delete').pass, true);
  assert.equal(verifyRoundtrip(after, { ...deleted, current: { current: old } }, fixture, 'web-principle-delete').pass, false);
});
test('native task/current originals require full exact current DTO; a search result or stale version is insufficient', () => {
  const task = { id: 't', body: 'task body', status: 'done', version: 2, result_record_id: 'r', result_record: { id: 'r', title: 'result', summary: 'summary' } };
  assert.equal(hasRoundtripOriginal('get_task', { structuredContent: task }, 'task', task), true);
  assert.equal(hasRoundtripOriginal('search', { structuredContent: task }, 'task', task), false);
  assert.equal(hasRoundtripOriginal('get_task', { ...task, version: 1 }, 'task', task), false);
  const principle = { id: 'p', body: '11 진행', version: 2, is_current: true };
  assert.equal(hasRoundtripOriginal('get_current_principle', [{ text: JSON.stringify({ current: principle }) }], 'principle', principle), true);
  assert.equal(hasRoundtripOriginal('get_current_principle', { current: { ...principle, is_current: false } }, 'principle', principle), false);
  const evidence = { mode: 'roundtrip-task-read', exitCode: 0, completedSkillRead: true, originalSourceRead: true, independent: { pass: true }, mutationCalls: 0 };
  assert.equal(assessRoundtripNative(evidence).pass, false);
  assert.equal(assessRoundtripNative({ ...evidence, completedTaskRead: true, answer: { roundtrip: { correct: true } } }).pass, true);
});
test('principle explanation binds current/past conditions and IDs, rejecting swapped answers despite successful original reads', () => {
  const fixture = { ...f, principle: { id: 'current-id', body: '현재 조건: 속성2가 11이면 진행' }, record: { id: 'source-id', body: 'SOURCE-code; 당시 속성2=7; 초기 기준에서는 보류' }, originalDetail: 'SOURCE-code' };
  const good = '## 현재 원칙\n원문 ID: current-id\n속성2가 11이면 진행합니다.\n\n## 과거 기록\n원문 ID: source-id\n당시 속성2=7; 초기 기준에서는 보류였습니다.';
  const swapped = '현재 원칙 current-id: 속성2가 7이면 보류합니다.\n과거 기록 source-id: 속성2가 11이면 진행합니다.';
  const wrongIds = '현재 원칙 source-id: 속성2가 11이면 진행합니다.\n과거 기록 current-id: 속성2가 7이면 보류합니다.';
  assert.equal(roundtripAnswerProof(good, fixture, 'roundtrip-principle-read').correct, true);
  assert.equal(roundtripAnswerProof(swapped, fixture, 'roundtrip-principle-read').correct, false);
  assert.equal(roundtripAnswerProof(wrongIds, fixture, 'roundtrip-principle-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('11이면 진행합니다', '11이면 진행하지 않습니다'), fixture, 'roundtrip-principle-read').correct, false);
  assert.equal(roundtripAnswerProof(good.replace('11이면 진행합니다', '11이면 보류합니다'), fixture, 'roundtrip-principle-read').correct, false);
  const e = { mode: 'roundtrip-principle-read', exitCode: 0, completedSkillRead: true, originalSourceRead: true, currentPrincipleRead: true, independent: { pass: true }, mutationCalls: 0 };
  assert.equal(assessRoundtripNative({ ...e, answer: { roundtrip: roundtripAnswerProof(swapped, fixture, e.mode) } }).pass, false);
  assert.equal(assessRoundtripNative({ ...e, answer: { roundtrip: roundtripAnswerProof(good, fixture, e.mode) } }).pass, true);
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
});
test('read-only phase detects a memo write even when a task still reports done', () => {
  const before = { ...empty(), tasks: [{ id: 't', status: 'done', version: 2 }], records: [{ id: 'r', body: 'old', version: 1 }] };
  assert.equal(verifyRoundtrip(before, structuredClone(before), f, 'roundtrip-task-read').pass, true);
  assert.equal(verifyRoundtrip(before, { ...before, records: [{ id: 'r', body: 'new', version: 2 }] }, f, 'roundtrip-task-read').pass, false);
});
test('phase intent is durable before work; a killed phase blocks replay and remembers even failed new IDs', async () => {
  const journal = { roundtrip: { baseline: empty(), owned: {}, completed: [] } };
  const saved = []; const save = async () => saved.push(structuredClone(journal));
  await beginRoundtripPhase(journal, save, empty(), 'web-entity', { prop2: 7 });
  assert.equal(saved[0].roundtrip.pending.mode, 'web-entity');
  await assert.rejects(beginRoundtripPhase(journal, save, empty(), 'web-entity', {}), /reconcile/);
  const after = { ...empty(), entities: [{ ...f.entity, prop1: 'unexpected' }] };
  const proof = await finishRoundtripPhase(journal, save, after);
  assert.equal(proof.pass, false);
  assert.deepEqual(journal.roundtrip.owned.entities, ['e']);
  assert.ok(journal.roundtrip.pending);
});
