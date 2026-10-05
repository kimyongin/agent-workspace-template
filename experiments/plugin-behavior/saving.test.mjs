import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSaving, verifyStoredChange } from './saving.mjs';

const evidence = { exitCode: 0, completedSkillRead: true, originalSourceRead: true, answer: { savedId: true }, independent: { originalReads: true, allowedChange: true, newRecords: 1, recordKind: 'user', contentVerified: true, entityLinked: true } };
test('a requested record needs independent original content; search or a client success is insufficient', () => {
  assert.equal(assessSaving(evidence, 'save-record').pass, true);
  assert.equal(assessSaving({ ...evidence, independent: { ...evidence.independent, originalReads: false } }, 'save-record').pass, false);
  assert.equal(assessSaving({ ...evidence, independent: { ...evidence.independent, newRecords: 2 } }, 'save-record').pass, false);
  assert.equal(assessSaving({ ...evidence, answer: { savedId: true, approvalRequested: true } }, 'save-record').pass, false);
});

test('independent originals permit only the requested record, task result or memo correction', () => {
  const source = { id: 'source', body: 'old', version: 1 };
  const task = { id: 'task', status: 'open', version: 1, result_record_id: null, result_record: null };
  const before = { current: null, entities: [{ id: 'entity', prop2: 11 }], tasks: [task], records: [source], principles: [], tags: [] };
  const fixture = { entity: { id: 'entity', prop2: 11 }, task, originalDetail: 'SOURCE-123', saving: { correction: 'corrected' } };
  const user = { id: 'new', record_kind: 'user', body: 'SOURCE-123 current 11', entity_ids: ['entity'] };
  assert.equal(verifyStoredChange(before, { ...before, records: [source, user] }, fixture, 'save-record').allowedChange, true);
  assert.equal(verifyStoredChange(before, { ...before, records: [{ ...source, body: 'tampered' }, user] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...before, entities: [], records: [source, user] }, fixture, 'save-record').allowedChange, false);
  const result = { ...user, record_kind: 'result', task_id: 'task', occurred_at: '2026-10-06T00:00:00Z', version: 1 };
  const done = { ...task, status: 'done', version: 2, completed_at: result.occurred_at, result_record_id: 'new', result_record: { id: 'new', title: 'result', summary: 'review' } };
  const completed = { ...before, tasks: [done], records: [source, result] };
  assert.equal(verifyStoredChange(before, completed, fixture, 'save-task').taskCompleted, true);
  const corrected = { ...completed, records: [source, { ...result, body: 'corrected', version: 2 }] };
  const memoFixture = { ...fixture, saving: { ...fixture.saving, recordId: 'new' } };
  assert.equal(verifyStoredChange(completed, corrected, memoFixture, 'save-memo').identityUnchanged, true);
  assert.equal(verifyStoredChange(completed, { ...corrected, records: [source, { ...corrected.records[1], occurred_at: 'changed' }] }, memoFixture, 'save-memo').allowedChange, false);
});
