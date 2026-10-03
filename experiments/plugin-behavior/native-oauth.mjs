// Codex MCP-native OAuth in a new home, authenticated via the real local web consent UI.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { outsideDirectory } from './files.mjs';

const [environmentFile, outputDirectory, webUrl] = process.argv.slice(2);
if (!environmentFile || !outputDirectory || !webUrl || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') {
  throw new Error('Exclusive local environment handoff required. Usage: native-oauth.mjs <allocated-env-file> <outside-dir> <loopback-web-url>');
}
const env = parseEnv(await readFile(environmentFile, 'utf8'));
for (const value of [env.VITE_SUPABASE_URL, webUrl]) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Only allocated loopback services allowed');
}
const output = await outsideDirectory(outputDirectory);
const codexHome = await outsideDirectory(resolve(output, 'codex-native-home'));
const mcpUrl = `${env.VITE_SUPABASE_URL}/functions/v1/mcp`;
await writeFile(resolve(codexHome, 'config.toml'), `mcp_oauth_credentials_store = "file"\n[mcp_servers.workspace]\nurl = ${JSON.stringify(mcpUrl)}\n`, { flag: 'wx' });
await writeFile(resolve(codexHome, '.plugin-behavior-native.json'), `${JSON.stringify({ experiment: 'plugin-behavior', home: codexHome, endpoint: mcpUrl })}\n`, { flag: 'wx' });
const child = spawn('codex', ['mcp', 'login', 'workspace', '--scopes', 'openid,email'], { cwd: output, env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['ignore', 'pipe', 'pipe'] });
let transcript = '';
let notified;
const authorization = new Promise((resolveUrl) => { notified = resolveUrl; });
for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
  transcript += chunk.toString();
  const match = transcript.match(/https?:\/\/[^\s]+\/oauth\/authorize\?[^\s]+/);
  if (match) notified(match[0]);
});
const timer = setTimeout(() => child.kill(), 90000);
const closed = new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
let browser;
try {
  const url = await Promise.race([authorization, closed.then(() => { throw new Error('Native login ended before authorization URL'); })]);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${webUrl}/login`);
  await page.getByLabel('이메일').fill(env.DEV_USER_A_EMAIL);
  await page.getByLabel('비밀번호').fill(env.DEV_USER_A_PASSWORD);
  await page.getByRole('button', { name: '이메일로 로그인' }).click();
  await page.getByRole('heading', { name: '할 일', level: 1 }).waitFor();
  await page.goto(url);
  await page.getByRole('heading', { name: '에이전트 연결 승인' }).waitFor();
  await page.getByRole('button', { name: '승인', exact: true }).click();
  const exitCode = await closed;
  const success = exitCode === 0 && /successfully|authenticated|logged in/i.test(transcript);
  const evidence = { client: 'codex-cli MCP native login', isolatedHome: codexHome, endpoint: mcpUrl, consent: 'real local dev login and web approve button', exitCode, success, credentialsStoredInIsolatedHome: true, tokenOrAuthorizationUrlInEvidence: false };
  await writeFile(resolve(output, 'native-oauth-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  if (!success) process.exitCode = 1;
} catch {
  // Browser errors can include the authorization URL; discard their raw message.
  console.error('Native OAuth failed; no raw browser error or authorization URL logged');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close();
  child.kill();
}
