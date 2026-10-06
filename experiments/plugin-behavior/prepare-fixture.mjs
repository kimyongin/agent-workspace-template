// Root-allocated loopback only. Fresh owner; public verification; durable own cleanup.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createClient } from '@supabase/supabase-js';
import { outsideDirectory } from './files.mjs';
import { readJournal, saveJournal, setupOwned, cleanupOwned, createOwned } from './journal.mjs';
import { createOwnedUser, deleteOwnedUser } from './owned-auth.mjs';
import { ownedConsent } from './owned-consent.mjs';
import { readPreparationState } from './preparation.mjs';
import { cleanupSavingRecords } from './saving-session.mjs';
import { cleanupRoundtrip, prepareRoundtripProfile } from './roundtrip-session.mjs';

const [operation, source, clientName, outputDirectory, scenario = 'normal'] = process.argv.slice(2);
if (!['normal', 'missing', 'conflict', 'roundtrip'].includes(scenario)) throw new Error('Only owned documented preparation scenarios');
if (!['setup', 'baseline', 'verify', 'cleanup'].includes(operation) || !source || !['codex-cli', 'claude-cli'].includes(clientName) || !outputDirectory || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') throw new Error('Root exclusive-local handoff required: prepare-fixture.mjs setup|baseline|verify|cleanup <allocated-source> <client> <outside-output>');
const output = await outsideDirectory(outputDirectory), fixturePath = resolve(output, `${clientName}-fixture.json`);
const { chromium } = await import(pathToFileURL(resolve(source, 'node_modules/@playwright/test/index.mjs')).href);
const helpers = await import(pathToFileURL(resolve(source, 'e2e/support.ts')).href);
const { readLocalConfig } = await import(pathToFileURL(resolve(source, 'scripts/local-config.mjs')).href);
const { webUrl } = readLocalConfig(pathToFileURL(resolve(source, 'supabase/config.toml')));
const endpoint = helpers.MCP_URL, env = helpers.env;
const local = new URL(endpoint);
if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(local.hostname)) throw new Error('Only allocated loopback services');
const admin = createClient(env.VITE_SUPABASE_URL, env.LOCAL_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let journal, browser, client;
const save = () => saveJournal(fixturePath, journal);
async function call(name, input) {
  const response = await client.callTool({ name, arguments: input });
  if (response.isError) throw new Error(`Public fixture tool ${name} failed; no payload logged`);
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}
try {
  if (operation === 'setup') {
    const marker = `plugin-${clientName}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    journal = { journalVersion: 1, clientName, marker, scenario, state: 'awaiting-auth', endpoint, environmentHandoff: 'exclusive-local', originalDetail: `SOURCE-${randomUUID().slice(0, 8)}`, serverRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), productSource: resolve(process.cwd(), 'plugins/workspace'), outputRoot: resolve(output, marker), preparation: true };
    await saveJournal(fixturePath, journal, true);
    await createOwnedUser(journal, save, admin);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ baseURL: webUrl });
    await page.goto('/login'); await page.getByLabel('이메일').fill(journal.authEmail); await page.getByLabel('비밀번호').fill(journal.authPassword);
    await page.getByRole('button', { name: '이메일로 로그인', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login');
    await ownedConsent(page, env, journal, save);
    journal.state = 'creating'; await save(); await browser.close();
  } else journal = await readJournal(fixturePath, endpoint, clientName);
  const ownsBusiness = Boolean(journal.roundtrip) || ['record', 'task', 'principle', 'entity', 'tag'].some(kind => journal[kind]);
  if (journal.token && journal.state !== 'cleaned') {
    const claims = JSON.parse(Buffer.from(journal.token.split('.')[1], 'base64url').toString());
    if (claims.exp * 1000 <= Date.now() + 30000) throw new Error('Fixture OAuth expired; no blind client retry');
    client = new Client({ name: 'prepare-independent', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${journal.token}` } } }));
  }
  if (operation === 'setup') {
    if (scenario === 'roundtrip') {
      await prepareRoundtripProfile(journal, save, call, () => client.listTools());
      console.log(JSON.stringify({ operation, clientName, state: journal.state, authOnly: true, fixturePath, rawAuthOrBodiesLogged: false }));
    } else {
    await setupOwned(journal, save, call, () => client.listTools());
    journal.state = 'creating'; await save();
    await createOwned(journal, save, call, 'task', { kind: 'once', title: `${journal.marker}-task`, summary: '다음 검토에서 최신 수치와 과거 원문을 확인하고 가능한 순서를 준비한다.', entity_ids: [journal.entity.id] });
    journal.entity = await call('update_entity', { id: journal.entity.id, expected_version: journal.entity.version, prop2: 11 }); await save();
    if (scenario === 'missing') {
      await save(); await call('delete_principle', { id: journal.principle.id, expected_version: journal.principle.version });
      journal.deleted = { principle: true }; await save();
    }
    if (scenario === 'conflict') {
      await save(); journal.principle = await call('update_principle', { id: journal.principle.id, expected_version: journal.principle.version, title: journal.principle.title, summary: '검토의 필수 수치 조건', body: '대상 속성 2가 20 이상일 때만 검토를 실행한다. 20 미만이면 실행을 보류하고 확인할 점을 준비한다.' }); await save();
      journal.record = await call('update_record', { id: journal.record.id, expected_version: journal.record.version, summary: '현재 기준과 충돌하는 이전 실행 판단', body: `원문 검증 코드는 ${journal.originalDetail}이다. 대상 속성 2가 11일 때도 검토를 즉시 실행해도 된다는 이전 판단을 남겼다. 현재 판단 기준과 일치하는지는 별도 확인이 필요하다.` }); await save();
    }
    journal.baseline = await readPreparationState(call); journal.state = 'ready'; await save();
    console.log(JSON.stringify({ operation, clientName, state: journal.state, syntheticOwner: true, fixturePath, counts: journal.baseline.counts, rawAuthOrBodiesLogged: false }));
    }
  } else if (operation === 'cleanup') {
    if (ownsBusiness && !client && journal.state !== 'cleaned') throw new Error('Own business cleanup needs valid OAuth; auth identity retained');
    if (client) {
      if (journal.roundtrip) {
        await cleanupRoundtrip(journal, save, call);
        if (journal.oauthClientId && !journal.oauthDeleted) { const { error } = await admin.auth.admin.oauth.deleteClient(journal.oauthClientId); if (error && error.status !== 404) throw new Error('Own DCR cleanup failed'); journal.oauthDeleted = true; await save(); }
      } else {
      await cleanupSavingRecords(journal, save, call);
      await cleanupOwned(journal, save, call, async id => { const { error } = await admin.auth.admin.oauth.deleteClient(id); if (error && error.status !== 404) throw new Error('Own DCR cleanup failed'); });
      }
    }
    else if (journal.oauthClientId && !journal.oauthDeleted) { const { error } = await admin.auth.admin.oauth.deleteClient(journal.oauthClientId); if (error && error.status !== 404) throw new Error('Own DCR cleanup failed'); journal.oauthDeleted = true; await save(); }
    await deleteOwnedUser(journal, save, admin);
    journal.state = 'cleaned'; delete journal.token; await save();
    console.log(JSON.stringify({ operation, clientName, deletedOnlyOwnedFixtures: true, authDeleted: journal.authDeleted, rawAuthOrBodiesLogged: false }));
  } else {
    if (journal.state !== 'ready') throw new Error('Only complete ready fixture can be independently read');
    const after = await readPreparationState(call);
    if (operation === 'baseline') { journal.baseline = after; await save(); }
    const evidence = { operation, clientName, unchanged: after.digest === journal.baseline.digest, beforeCounts: journal.baseline.counts, afterCounts: after.counts, independentPublicOriginalReads: true, rawAuthOrBodiesLogged: false };
    await writeFile(resolve(output, `${clientName}-prepare-independent.json`), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
    if (!evidence.unchanged) process.exitCode = 1;
  }
} catch {
  console.error('Preparation fixture failed; own journal retained for cleanup, raw auth/browser payload omitted'); process.exitCode = 1;
} finally { await client?.close(); await browser?.close(); }
