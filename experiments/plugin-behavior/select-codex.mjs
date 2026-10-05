// Separate offline skill-selection proof. No service or fixture access.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const [market] = process.argv.slice(2);
if (!market) throw new Error('Usage: select-codex.mjs <outside-copy-marketplace>');
const model = 'gpt-6.1-sol';
const effort = 'medium';
const expected = createHash('sha256').update(await readFile(resolve(market, 'plugins/workspace/skills/workspace/SKILL.md'))).digest('hex');
const args = ['exec', '--ignore-user-config', '--ignore-rules', '--strict-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', model, '--json', '-c', 'approval_policy="never"', '-c', `model_reasoning_effort=${JSON.stringify(effort)}`, '-c', 'marketplaces.workspace-behavior.source_type="local"', '-c', `marketplaces.workspace-behavior.source=${JSON.stringify(resolve(market))}`, '-c', 'plugins."workspace@workspace-behavior".enabled=true', '-c', 'plugins."workspace@workspace-behavior".mcp_servers.workspace.enabled=false'];
const prompt = '$workspace Use the selected workspace product skill. This is only a read-only offline selection check. Read the selected product SKILL.md with a read-only file command. This skill has no linked domain reference files. Do not connect to MCP, access business data, read credentials or change files. Report only the selected skill name and its Entity tool names. Do not use other skills.';
const evidence = { requested: { model, effort }, expectedSharedSkillSha256: expected, readsSkill: false, completedRead: false, reportedEntityTools: false, mcpCalls: 0 };
const child = spawn('codex', [...args, prompt], { cwd: market, stdio: ['ignore', 'pipe', 'pipe'] });
const timer = setTimeout(() => child.kill(), 90000);
child.stderr.resume();
createInterface({ input: child.stdout }).on('line', (line) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const item = event.item;
  if (item?.type === 'command_execution') {
    evidence.readsSkill ||= /SKILL\.md/.test(item.command ?? '');
    evidence.completedRead ||= /SKILL\.md/.test(item.command ?? '') && item.status === 'completed' && item.exit_code === 0;
  }
  if (item?.type === 'agent_message') evidence.reportedEntityTools ||= ['list_entities', 'get_entity', 'create_entity', 'update_entity', 'delete_entity'].every((name) => (item.text ?? '').includes(name));
  if (item?.type === 'mcp_tool_call') evidence.mcpCalls++;
  if (event.type === 'turn.completed') evidence.usage = event.usage;
});
const code = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
clearTimeout(timer);
evidence.exitCode = code;
await writeFile(resolve(market, '../skill-selection.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
if (code !== 0 || !evidence.completedRead || !evidence.reportedEntityTools || evidence.mcpCalls) process.exitCode = 1;
