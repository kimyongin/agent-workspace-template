// Separate offline skill-selection proof. No service or fixture access.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const [market, snapshot] = process.argv.slice(2);
if (!market || !snapshot) throw new Error('Usage: select-codex.mjs <outside-copy-marketplace> <current-codex-snapshot>');
const assignment = JSON.parse(execFileSync(process.execPath, [resolve(repo, 'scripts/agent-models.mjs'), 'assign', '--client', 'codex-cli', '--tier', 'balanced', '--effort', 'medium', '--role', 'implement', '--reason', '제품 스킬 선택의 독립 오프라인 증거', '--snapshot', snapshot], { encoding: 'utf8' }));
const expected = createHash('sha256').update(await readFile(resolve(market, 'plugins/workspace/skills/workspace/SKILL.md'))).digest('hex');
const args = ['exec', '--ignore-user-config', '--ignore-rules', '--strict-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', assignment.model, '--json', '-c', 'approval_policy="never"', '-c', `model_reasoning_effort=${JSON.stringify(assignment.effort)}`, '-c', 'marketplaces.workspace-behavior.source_type="local"', '-c', `marketplaces.workspace-behavior.source=${JSON.stringify(resolve(market))}`, '-c', 'plugins."workspace@workspace-behavior".enabled=true', '-c', 'plugins."workspace@workspace-behavior".mcp_servers.workspace.enabled=false'];
const prompt = '$workspace Use the selected workspace product skill. This is only a read-only offline selection check. Read the selected product SKILL.md and its example-entity reference with a read-only file command. Do not connect to MCP, access business data, read credentials or change files. Report only the SHA-256 of the selected SKILL.md. Do not use other skills.';
const evidence = { assignment, expectedSharedSkillSha256: expected, readsSkill: false, readsReference: false, returnedHashMatches: false, mcpCalls: 0 };
const child = spawn('codex', [...args, prompt], { cwd: market, stdio: ['ignore', 'pipe', 'pipe'] });
const timer = setTimeout(() => child.kill(), 90000);
child.stderr.resume();
createInterface({ input: child.stdout }).on('line', (line) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const item = event.item;
  if (item?.type === 'command_execution') {
    evidence.readsSkill ||= /SKILL\.md/.test(item.command ?? '');
    evidence.readsReference ||= /example-entity\.md/.test(item.command ?? '');
  }
  if (item?.type === 'agent_message') evidence.returnedHashMatches ||= (item.text ?? '').includes(expected);
  if (item?.type === 'mcp_tool_call') evidence.mcpCalls++;
  if (event.type === 'turn.completed') evidence.usage = event.usage;
});
const code = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
clearTimeout(timer);
evidence.exitCode = code;
await writeFile(resolve(market, '../skill-selection.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
if (code !== 0 || !evidence.readsSkill || !evidence.readsReference || !evidence.returnedHashMatches || evidence.mcpCalls) process.exitCode = 1;
