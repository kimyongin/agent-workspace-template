// Completes a CLI-issued native OAuth request through the real local consent UI.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { outsideDirectory } from './files.mjs';

const [environmentFile, requestFile, webUrl, evidenceFile] = process.argv.slice(2);
if (!environmentFile || !requestFile || !webUrl || !evidenceFile || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') throw new Error('Exclusive local handoff required');
const env = parseEnv(await readFile(environmentFile, 'utf8'));
let url;
try { url = new URL(JSON.parse(await readFile(requestFile, 'utf8')).url); }
catch { throw new Error('Native request invalid; raw authorization details omitted'); }
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.origin !== env.VITE_SUPABASE_URL || !url.pathname.endsWith('/oauth/authorize') || url.searchParams.get('code_challenge_method') !== 'S256' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(webUrl)) throw new Error('Only allocated local PKCE authorization and web origins allowed');
let callback;
try { callback = new URL(url.searchParams.get('redirect_uri')); }
catch { throw new Error('Expected normal loopback CLI callback'); }
if (callback.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(callback.hostname)) throw new Error('Expected normal loopback CLI callback');
await outsideDirectory(dirname(resolve(evidenceFile)));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${webUrl}/login`);
  await page.getByLabel('이메일').fill(env.DEV_USER_A_EMAIL);
  await page.getByLabel('비밀번호').fill(env.DEV_USER_A_PASSWORD);
  await page.getByRole('button', { name: '이메일로 로그인' }).click();
  await page.getByRole('heading', { name: '할 일', level: 1 }).waitFor();
  await page.goto(url.href);
  await page.getByRole('heading', { name: '에이전트 연결 승인' }).waitFor();
  await page.getByRole('button', { name: '승인', exact: true }).click();
  await page.waitForURL((current) => current.origin === callback.origin && current.pathname === callback.pathname);
  const evidence = { realLocalLogin: true, realApproveButton: true, callbackReached: true, callbackIntercepted: false, tokenInjected: false, cliNativeSuccessRequiresSeparateObservation: true, noAuthorizationUrlOrTokenLogged: true };
  await writeFile(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} catch {
  console.error('Native web consent failed; raw browser/authorization details omitted');
  process.exitCode = 1;
} finally { await browser?.close(); }
