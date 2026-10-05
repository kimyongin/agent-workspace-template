export function assessPreparation(evidence, scenario) {
  const failures = [];
  if (evidence.exitCode !== 0) failures.push('native-exit');
  if (!evidence.completedSkillRead) failures.push('skill-activation');
  if (evidence.mutationCalls !== 0) failures.push('unexpected-write');
  for (const name of ['originalDetail', 'currentValue', 'sourceId', 'taskId']) if (!evidence.answer?.[name]) failures.push(name);
  if (!(scenario === 'missing' ? evidence.answer?.missingCurrentPrinciple : evidence.answer?.currentPrincipleId)) failures.push('current-criterion');
  if (scenario !== 'normal' && !evidence.answer?.uncertainty) failures.push('uncertainty');
  if (scenario === 'conflict' && !evidence.answer?.conflict) failures.push('conflict');
  if (['semantic-failure', 'index-delay'].includes(scenario)) {
    if (evidence.proxy?.mode !== scenario || !evidence.proxy?.sameInstance || !(evidence.proxy?.applied >= 1)) failures.push('fault-not-applied');
    if (!(evidence.proxy?.keywordFallbacks >= 1 && evidence.proxy?.originalReads >= 1 && evidence.originalSourceRead)) failures.push('original-keyword-fallback');
    if (!evidence.answer?.[scenario === 'semantic-failure' ? 'searchFailure' : 'indexDelay']) failures.push('dependency-explanation');
  }
  return { pass: failures.length === 0, failures };
}
