import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompletedSharedSkillOutput } from './skill-output-proof.mjs';

const canonical = '---\nname: workspace\n---\n\n# Workspace\nRead current facts and original records.\nConfirm requested writes independently.\n';
test('dynamic native command reading needs the full canonical skill output and successful completion', () => {
  const event = { type: 'command_execution', command: 'Get-Content $selectedSkill', status: 'completed', exit_code: 0, aggregated_output: canonical.replaceAll('\n', '\r\n') };
  assert.equal(hasCompletedSharedSkillOutput(event, canonical), true);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, aggregated_output: '<skill>workspace</skill> Read current facts' }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, aggregated_output: canonical.slice(0, -20) }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, aggregated_output: canonical.replace('independently', 'automatically') }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, status: 'in_progress' }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, exit_code: 1 }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput({ ...event, type: 'agent_message' }, canonical), false);
  assert.equal(hasCompletedSharedSkillOutput(event, ''), false);
});
