// Inspect only a newly retained trial thread through supported native thread/read.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
const [evidencePath, sharedSkillPath] = process.argv.slice(2);
const trial = JSON.parse(await readFile(evidencePath, 'utf8'));
if (trial.client !== 'codex-cli' || !trial.mode.startsWith('prepare') || !/^[a-f0-9-]{36}$/.test(trial.threadId ?? '') || !/^workspace-prepare122-[a-f0-9]{32}$/.test(trial.marketplaceName)) throw new Error('Only exact own retained preparation trial');
const skill = await readFile(sharedSkillPath, 'utf8'), hash = createHash('sha256').update(skill).digest('hex');
if (hash !== trial.sharedSkillSha256) throw new Error('Trial shared skill source has changed');
const child = spawn(process.env.CODEX_CLI_BINARY ?? 'codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] }); child.stderr.resume();
const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
let thread;
const timer = setTimeout(() => child.kill(), 30000);
await new Promise((done, fail) => {
  createInterface({ input: child.stdout }).on('line', line => {
    let rpc; try { rpc = JSON.parse(line); } catch { return; }
    if (rpc.error) { fail(new Error('Own thread/read unavailable; no other thread inspected')); child.kill(); return; }
    if (rpc.id === 1) send(2, 'thread/read', { threadId: trial.threadId, includeTurns: true });
    if (rpc.id === 2) { thread = rpc.result.thread; done(); child.kill(); }
  }); child.on('error', fail); child.on('close', () => { if (!thread) fail(new Error('Own thread/read did not return')); });
  send(1, 'initialize', { clientInfo: { name: 'workspace-own-trial-context', version: '0.1.0' } });
}); clearTimeout(timer);
if (thread.id !== trial.threadId || !thread.path) throw new Error('Native thread identity mismatch');
const path = await realpath(thread.path), sessions = await realpath(resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'sessions'));
const childPath = relative(sessions, path);
if (isAbsolute(childPath) || childPath.startsWith('..') || !basename(path).includes(trial.threadId)) throw new Error('Own rollout path not scoped to allocated thread');
const rollout = await readFile(path, 'utf8');
let pathPresent = false, fullBodyPresent = false; const markers = new Set(), rowTypes = {};
const body = skill.replace(/^---[\s\S]*?---\s*/, '').trim();
for (const line of rollout.split('\n')) {
  let row; try { row = JSON.parse(line); } catch { continue; }
  rowTypes[row.type] = (rowTypes[row.type] ?? 0) + 1;
  const text = JSON.stringify(row).replaceAll('\\\\', '/');
  if (text.includes(trial.marketplaceName) && text.includes('skills/workspace/SKILL.md')) pathPresent = true;
  const inspect = value => { if (typeof value === 'string') { fullBodyPresent ||= value.includes(body); for (const marker of value.match(/<\/?(?:skill|skill_instructions|skills_instructions)>/g) ?? []) markers.add(marker); } else if (value && typeof value === 'object') for (const next of Object.values(value)) inspect(next); };
  inspect(row);
}
const result = { threadId: trial.threadId, sharedSkillSha256: hash, ownProductPathPresent: pathPresent, fullSharedSkillBodyPresent: fullBodyPresent, contextMarkers: [...markers], rowTypes, inspection: 'supported exact thread/read and its own returned native rollout only; generic catalog markers are not product activation proof' };
await writeFile(resolve(evidencePath, '../skill-context.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
