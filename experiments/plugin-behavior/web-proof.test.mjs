import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webFieldLabel, webFailureDiagnostic } from './web-proof.mjs';

test('actual Field required suffix is accepted without matching another field or regex characters', () => {
  const email = webFieldLabel('이메일');
  assert.equal(email.test('이메일'), true);
  assert.equal(email.test('이메일 (필수)'), true);
  assert.equal(email.test('이메일*(필수)'), true);
  assert.equal(email.test('이메일 알림'), false);
  assert.equal(email.test('다른 이메일 (필수)'), false);
  assert.equal(webFieldLabel('속성 1').test('속성 10'), false);
  assert.equal(webFieldLabel('필드 [A]').test('필드 [A] (필수)'), true);
  assert.equal(webFieldLabel('필드 [A]').test('필드 A'), false);
});
test('failure evidence reports known structural categories, never raw exception/auth/locator payload', () => {
  const error = new Error('Bearer private-token; password=private-body; https://private.example'); error.name = 'TimeoutError';
  assert.deepEqual(webFailureDiagnostic(error), { errorClass: 'TimeoutError', diagnosticCode: 'timeout' });
  error.name = 'private-token'; error.code = 'private-body';
  assert.deepEqual(webFailureDiagnostic(error), { errorClass: 'UnknownError', diagnosticCode: 'phase-error' });
  assert.equal(JSON.stringify(webFailureDiagnostic(error)).includes('private'), false);
});
