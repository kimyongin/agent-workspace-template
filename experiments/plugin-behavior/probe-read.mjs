// Non-business native file-tool probe. No plugin, MCP request or credential read.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outsideDirectory } from './files.mjs';
const [directory, snapshot] = process.argv.slice(2);
const output = await outsideDirectory(directory);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const assignment = JSON.parse(execFileSync(process.execPath, [resolve(repo, 'scripts/agent-models.mjs'), 'assign', '--client', 'codex-cli', '--tier', 'balanced', '--effort', 'medium', '--role', 'implement', '--reason', '승인된 무해한 native 읽기 경로 진단', '--snapshot', snapshot], { encoding: 'utf8' }));
await writeFile(resolve(output, 'PROBE.md'), '# PREPARATION READ PROBE\n', { flag: 'wx' });
const binary = process.env.CODEX_CLI_BINARY ?? 'codex';
const results = [];
for (const [name, flags] of [['ignore-strict', ['--ignore-user-config', '--strict-config']], ['ignore-only', ['--ignore-user-config']], ['strict-only', ['--strict-config']]]) {
  const evidence = { name, toolTypes: [], titleRead: false, mcpCalls: 0 };
  const args = ['exec', ...flags, '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', assignment.model, '--json', '--disable', 'plugins', '--disable', 'apps', '--disable', 'multi_agent', '-c', `model_reasoning_effort=${JSON.stringify(assignment.effort)}`, '-c', 'approval_policy="never"'];
  const child = spawn(binary, [...args, 'Read the first line of PROBE.md in the current folder using a read-only native file command, then report that title. Do not read any other file or call MCP, apps, plugins or web tools.'], { cwd: output, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 60000);
  createInterface({ input: child.stdout }).on('line', line => {
    let event; try { event = JSON.parse(line); } catch { return; }
    const item = event.item;
    if (item?.type && !evidence.toolTypes.includes(item.type)) evidence.toolTypes.push(item.type);
    if (item?.type === 'mcp_tool_call') { evidence.mcpCalls++; child.kill(); }
    if (item?.type === 'agent_message') evidence.titleRead ||= item.text?.includes('PREPARATION READ PROBE') ?? false;
  });
  evidence.exitCode = await new Promise((done, fail) => { child.on('error', fail); child.on('close', done); }); clearTimeout(timer);
  results.push(evidence); await writeFile(resolve(output, 'read-probes.json'), JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(evidence));
}
