// Field.tsx's star is aria-hidden; its accessible required suffix is (필수).
// Keep matching anchored and let Playwright's strict locator reject duplicates.
export function webFieldLabel(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*(?:\\*?\\s*\\(필수\\))?\\s*$`);
}

export function webFailureDiagnostic(error) {
  const errorClass = ['Error', 'TimeoutError', 'AssertionError', 'TypeError', 'SyntaxError'].includes(error?.name) ? error.name : 'UnknownError';
  const diagnosticCode = errorClass === 'TimeoutError' ? 'timeout' : errorClass === 'AssertionError' || error?.matcherResult ? 'assertion-failed' : ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code) ? 'connection-failed' : 'phase-error';
  return { errorClass, diagnosticCode };
}
