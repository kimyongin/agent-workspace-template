import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPreparation } from './assess-preparation.mjs';
const success = () => ({ exitCode: 0, completedSkillRead: true, mutationCalls: 0, originalSourceRead: true, answer: { originalDetail: true, currentValue: true, sourceId: true, currentPrincipleId: true, taskId: true, uncertainty: true, missingCurrentPrinciple: true, conflict: true, searchFailure: true, indexDelay: true }, proxy: { mode: 'semantic-failure', applied: 1, keywordFallbacks: 1, originalReads: 1, sameInstance: true } });
test('semantic failure needs applied dependency fault, warning and original keyword fallback', () => {
  assert.equal(assessPreparation(success(), 'semantic-failure').pass, true);
  for (const field of ['applied', 'keywordFallbacks', 'originalReads']) {
    const evidence = success(); evidence.proxy[field] = 0;
    assert.equal(assessPreparation(evidence, 'semantic-failure').pass, false, field);
  }
  const noWarning = success(); noWarning.answer.searchFailure = false;
  assert.equal(assessPreparation(noWarning, 'semantic-failure').pass, false);
  const unread = success(); unread.originalSourceRead = false;
  assert.equal(assessPreparation(unread, 'semantic-failure').pass, false);
});
test('index delay cannot borrow failure evidence or omit delay explanation', () => {
  const evidence = success(); evidence.proxy.mode = 'index-delay';
  assert.equal(assessPreparation(evidence, 'index-delay').pass, true);
  evidence.answer.indexDelay = false;
  assert.equal(assessPreparation(evidence, 'index-delay').pass, false);
  evidence.answer.indexDelay = true; evidence.proxy.mode = 'semantic-failure';
  assert.equal(assessPreparation(evidence, 'index-delay').pass, false);
});
test('missing/conflict require uncertainty and their own condition, writes never pass', () => {
  for (const scenario of ['normal', 'missing', 'conflict']) {
    const evidence = success(); delete evidence.proxy;
    assert.equal(assessPreparation(evidence, scenario).pass, true);
    evidence.mutationCalls = 1;
    assert.equal(assessPreparation(evidence, scenario).pass, false);
  }
  for (const scenario of ['missing', 'conflict']) {
    const evidence = success(); evidence.answer.uncertainty = false;
    assert.equal(assessPreparation(evidence, scenario).pass, false);
  }
});
