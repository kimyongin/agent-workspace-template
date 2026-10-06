import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSaving, verifyStoredChange, classifyIndexStatements, classifyStorageStatements, newSavingIntent, savingPrompt } from './saving.mjs';

const evidence = { exitCode: 0, completedSkillRead: true, originalSourceRead: true, answer: { savedId: true }, independent: { originalReads: true, allowedChange: true, newRecords: 2, requestedRecords: 1, automaticChanges: 1, recordKind: 'user', contentVerified: true, entityLinked: true } };
test('failed storage explanations do not claim completion, while contradictory success still fails', () => {
  const failure = { ...evidence, independent: { ...evidence.independent, newRecords: 0 }, fault: { mode: 'save-failure', sameInstance: true, injected: 1, upstreamMutations: 0 } };
  for (const text of ['저장에 실패했습니다.', '생성하지 못했습니다.', '저장 완료했다고 말할 수 없습니다.', '저장되지 않았습니다.']) {
    const statements = classifyStorageStatements(text);
    assert.equal(statements.affirmative, 0, text);
    assert.equal(statements.negated, 1, text);
    assert.equal(assessSaving({ ...failure, answer: { failureExplained: true, completionClaim: statements.affirmative > 0 } }, 'save-failure').pass, true);
    assert.equal(statements.claims.every(claim => /^[a-f0-9]{64}$/.test(claim.sha256)), true);
  }
  for (const text of ['저장했습니다.', '기록을 생성했습니다.', '저장을 완료했습니다.', '저장에 성공했습니다.', '저장되었습니다.', '저장 완료했습니다. 검색은 확인하지 못했습니다.', '저장 실패했습니다. 그래도 저장 완료했습니다.']) {
    const statements = classifyStorageStatements(text);
    assert.equal(statements.affirmative, 1, text);
    assert.ok(assessSaving({ ...failure, answer: { failureExplained: true, completionClaim: statements.affirmative > 0 } }, 'save-failure').failures.includes('false-failure-completion'));
  }
  assert.equal(classifyStorageStatements('저장 상태를 조회했습니다.').affirmative, 0);
});
test('a requested record needs independent original content; search or a client success is insufficient', () => {
  assert.equal(assessSaving(evidence, 'save-record').pass, true);
  assert.equal(assessSaving({ ...evidence, independent: { ...evidence.independent, originalReads: false } }, 'save-record').pass, false);
  assert.equal(assessSaving({ ...evidence, independent: { ...evidence.independent, requestedRecords: 2 } }, 'save-record').pass, false);
  assert.equal(assessSaving({ ...evidence, answer: { savedId: true, approvalRequested: true } }, 'save-record').pass, false);
});

test('lost-response lookup recovery is valid but cannot claim an unobserved keyed replay', () => {
  const fault = { mode: 'save-response-loss', sameInstance: true, injected: 1, upstreamMutations: 1, requestIdHash: 'key-hash', originalConfirmation: true, originalReadConfirmation: true, sameInputRetry: false, replayCalls: 0, inputChanged: false };
  assert.equal(assessSaving({ ...evidence, fault }, 'save-response-loss').pass, true);
  assert.equal(assessSaving({ ...evidence, fault }, 'save-response-loss').replayObserved, false);
  assert.equal(assessSaving({ ...evidence, fault: { ...fault, sameInputRetry: true } }, 'save-response-loss').pass, false);
  assert.equal(assessSaving({ ...evidence, fault: { ...fault, originalReadConfirmation: false } }, 'save-response-loss').pass, false);
  assert.equal(assessSaving({ ...evidence, fault: { ...fault, upstreamMutations: 1, sameInputRetry: true, replayCalls: 1, originalReadConfirmation: true } }, 'save-response-loss').pass, true);
});

test('public entity related projections may change only to match the requested saved originals', () => {
  const t0 = '2026-10-06T00:00:00.000Z', t1 = '2026-10-06T00:01:00.000Z', t2 = '2026-10-06T00:02:00.000Z';
  const source = { id: 'source', title: 'old', updated_at: t0, entity_ids: ['entity'] };
  const task = { id: 'task', title: 'review', updated_at: t0, entity_ids: ['entity'], status: 'open', version: 1, result_record_id: null, result_record: null };
  const entity = { id: 'entity', prop1: 'customer', prop2: 11, version: 2, updated_at: t0, tasks: { count: 1, items: [{ id: 'task', title: 'review', updated_at: t0 }] }, records: { count: 1, items: [{ id: 'source', title: 'old', updated_at: t0 }] } };
  const before = { current: null, entities: [entity], tasks: [task], records: [source], principles: [], tags: [] };
  const user = { id: 'new', title: 'result', summary: 'review', body: 'SOURCE-123 current 11', version: 1, updated_at: t1, record_kind: 'user', entity_ids: ['entity'] };
  const event = { id: 'event', title: 'creation', updated_at: t2, record_kind: 'change', entity_ids: ['entity'], change: { event_id: 'event-identity', target_id: 'new', target_kind: 'record', target_title: 'result', action: 'create', source: 'mcp', path: '/records/new', before: null, after: { ...user } } };
  const afterEntity = { ...entity, records: { count: 3, items: [{ id: 'event', title: 'creation', updated_at: t2 }, { id: 'new', title: 'result', updated_at: t1 }, { id: 'source', title: 'old', updated_at: t0 }] } };
  const after = { ...before, entities: [afterEntity], records: [source, event, user] };
  const fixture = { entity, task, originalDetail: 'SOURCE-123' };
  assert.equal(verifyStoredChange(before, after, fixture, 'save-record').allowedChange, true);
  assert.equal(verifyStoredChange(before, { ...after, entities: [{ ...afterEntity, prop2: 12 }] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...after, entities: [{ ...afterEntity, records: { count: 4, items: afterEntity.records.items } }] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...after, entities: [{ ...afterEntity, tasks: { count: 1, items: [{ id: 'foreign', title: 'other', updated_at: t0 }] } }] }, fixture, 'save-record').allowedChange, false);
  const result = { ...user, record_kind: 'result', task_id: 'task', occurred_at: t1 };
  const done = { ...task, version: 2, status: 'done', updated_at: t1, completed_at: t1, result_record_id: 'new', result_record: { id: 'new', title: 'result', summary: 'review' } };
  const doneEntity = { ...entity, tasks: { count: 1, items: [{ id: 'task', title: 'review', updated_at: t1 }] }, records: { count: 2, items: [{ id: 'new', title: 'result', updated_at: t1 }, { id: 'source', title: 'old', updated_at: t0 }] } };
  const completed = { ...before, tasks: [done], records: [source, result], entities: [doneEntity] };
  assert.equal(verifyStoredChange(before, completed, fixture, 'save-task').allowedChange, true);
  assert.equal(verifyStoredChange(before, { ...completed, tasks: [{ ...done, result_record: { ...done.result_record, id: 'wrong' } }] }, fixture, 'save-task').allowedChange, false);
  const memoFixture = { ...fixture, saving: { recordId: 'new', correction: 'corrected' } };
  const corrected = { ...completed, records: [source, { ...result, body: 'corrected', version: 2, updated_at: t2 }], entities: [{ ...doneEntity, records: { count: 2, items: [{ id: 'new', title: 'result', updated_at: t2 }, { id: 'source', title: 'old', updated_at: t0 }] } }] };
  assert.equal(verifyStoredChange(completed, corrected, memoFixture, 'save-memo').allowedChange, true);
  assert.equal(verifyStoredChange(completed, { ...corrected, tasks: [{ ...done, version: 3 }] }, memoFixture, 'save-memo').allowedChange, false);
});

test('independent originals permit only the requested record, task result or memo correction', () => {
  const source = { id: 'source', body: 'old', version: 1 };
  const task = { id: 'task', status: 'open', version: 1, result_record_id: null, result_record: null };
  const before = { current: null, entities: [{ id: 'entity', prop2: 11 }], tasks: [task], records: [source], principles: [], tags: [] };
  const fixture = { entity: { id: 'entity', prop2: 11 }, task, originalDetail: 'SOURCE-123', saving: { correction: 'corrected' } };
  const user = { id: 'new', title: 'result', summary: 'review', version: 1, record_kind: 'user', body: 'SOURCE-123 current 11', entity_ids: ['entity'] };
  const event = { id: 'event', record_kind: 'change', entity_ids: ['entity'], change: { event_id: 'event-identity', target_id: 'new', target_kind: 'record', target_title: 'result', action: 'create', source: 'mcp', path: '/records/new', before: null, after: { ...user } } };
  const saved = { ...before, records: [source, event, user] };
  assert.equal(verifyStoredChange(before, saved, fixture, 'save-record').allowedChange, true);
  assert.equal(verifyStoredChange(before, saved, fixture, 'save-response-loss').recordId, 'new');
  assert.equal(verifyStoredChange(before, { ...saved, records: [source, { ...event, change: { ...event.change, after: null } }, user] }, fixture, 'save-record').allowedChange, true);
  assert.equal(verifyStoredChange(before, { ...saved, records: [source, user] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...saved, records: [source, event, user, { ...event, id: 'extra' }] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...saved, records: [source, { ...event, change: { ...event.change, target_id: 'wrong' } }, user] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...saved, records: [{ ...source, body: 'tampered' }, event, user] }, fixture, 'save-record').allowedChange, false);
  assert.equal(verifyStoredChange(before, { ...saved, entities: [] }, fixture, 'save-record').allowedChange, false);
  const result = { ...user, record_kind: 'result', task_id: 'task', occurred_at: '2026-10-06T00:00:00Z', version: 1 };
  const done = { ...task, status: 'done', version: 2, completed_at: '2026-10-06T00:00:00.016Z', result_record_id: 'new', result_record: { id: 'new', title: 'result', summary: 'review' } };
  const completed = { ...before, tasks: [done], records: [source, result] };
  assert.equal(verifyStoredChange(before, completed, fixture, 'save-task').taskCompleted, true);
  assert.equal(verifyStoredChange(before, { ...completed, tasks: [{ ...done, completed_at: null }] }, fixture, 'save-task').taskCompleted, false);
  const corrected = { ...completed, records: [source, { ...result, body: 'corrected', version: 2 }] };
  const memoFixture = { ...fixture, saving: { ...fixture.saving, recordId: 'new' } };
  assert.equal(verifyStoredChange(completed, corrected, memoFixture, 'save-memo').identityUnchanged, true);
  assert.equal(verifyStoredChange(completed, { ...corrected, records: [source, { ...corrected.records[1], occurred_at: 'changed' }] }, memoFixture, 'save-memo').allowedChange, false);
});

test('index statements distinguish affirmative completion from negated or unconfirmed completion', () => {
  for (const text of ['색인 완료했다고 확인하지 않았습니다.', '검색 반영이 완료되었다고 말할 수 없습니다.', '색인이 완료됐는지 확인하지 못했습니다.', '아직 색인 완료를 확인하지 못했습니다.']) {
    assert.equal(classifyIndexStatements(text).affirmative, 0, text);
    assert.equal(classifyIndexStatements(text).negated, 1, text);
  }
  for (const text of ['색인 완료를 확인했습니다.', '검색 반영이 완료되었습니다.', '검색 반영을 확인했습니다.', '색인은 완료됐지만 검색 화면은 확인하지 못했습니다.', '색인은 완료됐고 검색 화면은 확인하지 못했습니다.']) assert.equal(classifyIndexStatements(text).affirmative, 1, text);
  assert.equal(classifyIndexStatements('색인 완료를 확인했습니다. 다른 자료는 확인하지 못했습니다.').affirmative, 1);
  assert.equal(classifyIndexStatements('색인 상태만 확인했습니다.').affirmative, 0);
  assert.equal(assessSaving({ ...evidence, answer: { savedId: true, indexComplete: true } }, 'save-record').pass, false);
  const claims = classifyIndexStatements('키워드 검색 반영을 확인했습니다. 의미 색인 완료는 확인하지 못했습니다.').claims;
  assert.deepEqual(claims.map(({ subject, polarity, verb, keywordQualified, semanticQualified }) => ({ subject, polarity, verb, keywordQualified, semanticQualified })), [{ subject: 'search-reflection', polarity: 'affirmative', verb: 'confirm', keywordQualified: true, semanticQualified: false }, { subject: 'index', polarity: 'negated', verb: 'complete', keywordQualified: false, semanticQualified: true }]);
  assert.equal(claims.every(claim => /^[a-f0-9]{64}$/.test(claim.sha256)), true);
});

test('pending index-state observation is not completion; unrelated task completion cannot select the index verb', () => {
  for (const text of ['의미 검색 반영 대기 상태를 확인했습니다.', '할 일 완료 후 의미 검색 반영 pending 상태를 확인했습니다.', '의미 색인 지연 상태를 확인했습니다.']) {
    const result = classifyIndexStatements(text);
    assert.equal(result.affirmative, 0, text);
    assert.equal(result.stateOnly, 1, text);
    assert.equal(result.claims[0].verb, 'confirm');
    assert.equal(result.claims[0].reason, 'pending-state-observed');
    assert.equal(result.claims[0].predicate, 'state-observation');
  }
  for (const text of ['의미 색인 완료를 확인했습니다.', '의미 검색 반영을 확인했습니다.', '의미 색인은 대기했지만 의미 색인이 지금 완료됐습니다.', '의미 색인 완료 상태를 확인했습니다.', '의미 색인 대기 상태를 확인했습니다 현재 완료됐습니다.']) assert.equal(classifyIndexStatements(text).affirmative, 1, text);
  const confirmation = classifyIndexStatements('할 일 완료 후 키워드 검색 반영을 확인했습니다.').claims[0];
  assert.equal(confirmation.verb, 'confirm');
  assert.equal(confirmation.polarity, 'affirmative');
  const denied = classifyIndexStatements('의미 검색 반영 pending 상태를 확인했다고 말할 수 없습니다.');
  assert.equal(denied.affirmative, 0); assert.equal(denied.stateOnly, 0); assert.equal(denied.negated, 1);
});

test('each fresh memo request changes its correction while unchanged stored text cannot satisfy it', () => {
  const previous = { correction: 'already saved', recordId: 'result', ownedRecordIds: ['result'] };
  const next = newSavingIntent(previous, 'save-memo');
  assert.notEqual(next.correction, previous.correction);
  assert.equal(newSavingIntent(previous, 'save-task').correction, previous.correction);
  assert.equal(next.recordId, 'result');
  assert.equal(previous.correction, 'already saved');
  assert.ok(savingPrompt('save-memo', { marker: 'owned', saving: next }).includes(next.correction));
  const record = { id: 'result', record_kind: 'result', body: previous.correction, entity_ids: ['entity'], version: 1 };
  const state = { current: null, entities: [], tasks: [{ id: 'task' }], records: [record], principles: [], tags: [] };
  assert.equal(verifyStoredChange(state, state, { entity: { id: 'entity' }, task: { id: 'task' }, saving: next }, 'save-memo').contentVerified, false);
});

test('explicit keyword reflection confirmation needs actual correction lookup and independent saved content', () => {
  const confirmed = { subject: 'search-reflection', polarity: 'affirmative', verb: 'confirm', keywordQualified: true, semanticQualified: false };
  const memo = { ...evidence, independent: { ...evidence.independent, newRecords: 0, requestedRecords: 0, automaticChanges: 0, recordKind: 'result', identityUnchanged: true }, answer: { savedId: true, indexComplete: true, indexStatements: { claims: [confirmed, { subject: 'index', polarity: 'negated', verb: 'complete', semanticQualified: true }] } }, savedSearches: [{ correctionQueried: true, targetMatched: true, targetMatches: [{ match: 'keyword', index_state: 'pending' }], search_state: 'keyword_fallback', semantic_coverage: { pending: 6, excluded: 0 } }] };
  assert.equal(assessSaving(memo, 'save-memo').pass, true);
  for (const missing of [{ ...memo.savedSearches[0], correctionQueried: false }, { ...memo.savedSearches[0], targetMatched: false }, { ...memo.savedSearches[0], targetMatches: [{ match: 'semantic', index_state: 'indexed' }] }]) {
    assert.ok(assessSaving({ ...memo, savedSearches: [missing] }, 'save-memo').failures.includes('unverified-keyword-reflection'));
  }
  assert.equal(assessSaving({ ...memo, independent: { ...memo.independent, contentVerified: false } }, 'save-memo').pass, false);
  for (const strictClaim of [{ ...confirmed, subject: 'index' }, { ...confirmed, keywordQualified: false }, { ...confirmed, semanticQualified: true }, { ...confirmed, verb: 'complete' }]) {
    assert.ok(assessSaving({ ...memo, answer: { ...memo.answer, indexStatements: { claims: [strictClaim] } } }, 'save-memo').failures.includes('unverified-index-completion'));
  }
});
