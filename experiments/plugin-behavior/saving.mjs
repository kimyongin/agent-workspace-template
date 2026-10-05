export const savingModes = ['save-record', 'save-task', 'save-memo', 'save-failure', 'save-response-loss'];

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

// Inputs are complete, paginated public inventories followed by get_* originals.
// Return only structural facts, never the stored bodies or client-provided results.
export function verifyStoredChange(before, after, fixture, mode) {
  if (!savingModes.includes(mode)) throw new Error('Unknown saving scenario');
  const created = after.records.filter(row => !before.records.some(old => old.id === row.id));
  const target = mode === 'save-memo' ? after.records.find(row => row.id === fixture.saving?.recordId) : created[0];
  let allowedChange = ['current', 'entities', 'principles', 'tags'].every(kind => equal(before[kind], after[kind]));
  allowedChange &&= before.records.every(old => {
    const current = after.records.find(row => row.id === old.id);
    return mode === 'save-memo' && old.id === target?.id ? current && equal(without(old, ['body', 'version', 'updated_at']), without(current, ['body', 'version', 'updated_at'])) && current.version === old.version + 1 : equal(old, current);
  });
  const priorTask = before.tasks.find(row => row.id === fixture.task.id), task = after.tasks.find(row => row.id === fixture.task.id);
  const completionFields = ['status', 'version', 'updated_at', 'completed_at', 'result_record_id', 'result_record'];
  const taskCompleted = Boolean(task && priorTask && target && priorTask.status === 'open' && task.status === 'done' && task.version === priorTask.version + 1 && task.result_record_id === target.id && target.task_id === task.id && task.completed_at === target.occurred_at && equal(without(priorTask, completionFields), without(task, completionFields)));
  allowedChange &&= mode === 'save-task' ? taskCompleted && after.tasks.length === before.tasks.length && before.tasks.every(old => old.id === task.id || equal(old, after.tasks.find(row => row.id === old.id))) : equal(before.tasks, after.tasks);
  allowedChange &&= created.length === (['save-memo', 'save-failure'].includes(mode) ? 0 : 1);
  const oldTarget = before.records.find(row => row.id === target?.id);
  return { originalReads: true, allowedChange, newRecords: created.length, recordId: target?.id ?? null, recordKind: target?.record_kind ?? null, entityLinked: target?.entity_ids?.includes(fixture.entity.id) ?? false, contentVerified: Boolean(target && (mode === 'save-memo' ? target.body === fixture.saving.correction : target.body?.includes(fixture.originalDetail) && new RegExp(`(?<![a-zA-Z0-9-])${fixture.entity.prop2}(?![a-zA-Z0-9-])`).test(target.body))), taskCompleted, identityUnchanged: Boolean(oldTarget && target && equal(without(oldTarget, ['body', 'version', 'updated_at']), without(target, ['body', 'version', 'updated_at']))) };
}

export function savingPrompt(mode, fixture) {
  const context = `Workspace에서 ${fixture.marker}의 현재 대상 값, 판단 기준과 이전 기록의 원문을 확인해 줘. `;
  const requests = {
    'save-record': '지금 확인한 검토 결과를 이 대상의 새 일반 기록 하나로 저장해 줘. 할 일은 완료하지 마.',
    'save-task': '그 내용을 검토 결과로 남기면서 이 대상의 기존 일회성 검토 할 일을 완료해 줘. 결과는 하나의 기록으로 남겨 줘.',
    'save-memo': `이전에 완료한 검토 결과 기록의 메모 본문만 "${fixture.saving?.correction}"으로 정정해 줘. 새로운 기록이나 추가 편집 로그는 만들지 마.`,
    'save-failure': '지금 확인한 검토 결과를 이 대상의 새 일반 기록 하나로 저장해 줘. 실패하면 저장됐다고 말하지 말고 확인 가능한 상태를 알려 줘.',
    'save-response-loss': '지금 확인한 검토 결과를 이 대상의 새 일반 기록 하나로 저장해 줘. 응답이 불확실하면 같은 작업을 중복 저장하지 말고 원래 요청의 반영 여부를 확인해 줘.',
  };
  if (!savingModes.includes(mode) || (mode === 'save-memo' && !fixture.saving?.correction)) throw new Error('Owned saving scenario required');
  return context + requests[mode] + ' 요청한 것 외에는 자료를 변경하지 마. 실제 저장한 원문의 식별 정보와 확인한 상태를 알려 줘. 검색 반영을 확인하지 못했다면 완료로 추정하지 마.';
}

export function assessSaving(evidence, mode) {
  if (!savingModes.includes(mode)) throw new Error('Unknown saving scenario');
  const failures = [];
  for (const [name, satisfied] of Object.entries({ 'native-exit': evidence.exitCode === 0, 'skill-activation': evidence.completedSkillRead, 'original-source-read': evidence.originalSourceRead, 'independent-originals': evidence.independent?.originalReads, 'request-scope': evidence.independent?.allowedChange })) if (!satisfied) failures.push(name);
  if (evidence.answer?.approvalRequested) failures.push('repeated-approval');
  if (evidence.answer?.indexComplete) failures.push('unverified-index-completion');
  const proof = evidence.independent ?? {};
  if (mode === 'save-failure') {
    if (proof.newRecords !== 0 || !evidence.answer?.failureExplained || evidence.answer?.completionClaim) failures.push('false-failure-completion');
  } else {
    if (!evidence.answer?.savedId) failures.push('saved-source-id');
    if (!proof.contentVerified || !proof.entityLinked) failures.push('saved-content');
    if (mode === 'save-memo') {
      if (proof.newRecords !== 0 || !proof.identityUnchanged) failures.push('memo-identity-or-log');
    } else if (proof.newRecords !== 1 || proof.recordKind !== (mode === 'save-task' ? 'result' : 'user')) failures.push('single-requested-record');
    if (mode === 'save-task' && !proof.taskCompleted) failures.push('task-result');
  }
  if (['save-failure', 'save-response-loss'].includes(mode)) {
    const fault = evidence.fault;
    if (fault?.mode !== mode || !fault?.sameInstance || fault?.injected !== 1) failures.push('fault-not-applied');
    if (mode === 'save-failure' && fault?.upstreamMutations !== 0) failures.push('unexpected-upstream-write');
    if (mode === 'save-response-loss' && (!(fault?.upstreamMutations >= 1) || !fault?.sameInputRetry || !fault?.requestIdHash || !fault?.originalConfirmation)) failures.push('uncertain-write-confirmation');
  }
  return { pass: failures.length === 0, failures };
}
