import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { outsideDirectory } from './files.mjs';
import { saveJournal, readJournal, assertJournal, createOwned, cleanupOwned } from './journal.mjs';
import { createClient } from '@supabase/supabase-js';

const [operation, source, clientName, outputDirectory] = process.argv.slice(2);
if (!['setup', 'verify', 'cleanup'].includes(operation) || !source || !['codex-cli', 'claude-cli'].includes(clientName) || !outputDirectory || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') throw new Error('Exclusive local environment handoff required. Usage: fixture.mjs setup|verify|cleanup <candidate-checkout> codex-cli|claude-cli <outside-directory>');
const output = await outsideDirectory(outputDirectory);
const fixturePath = resolve(output, `${clientName}-fixture.json`);
const { chromium } = await import(pathToFileURL(resolve(source, 'node_modules/@playwright/test/index.mjs')).href);
const helpers = await import(pathToFileURL(resolve(source, 'e2e/support.ts')).href);
const endpoint = helpers.MCP_URL;
const url = new URL(endpoint);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Fixture only supports allocated loopback services');
let token;
let fixture;
let browser;
let client;
const save = () => saveJournal(fixturePath, fixture);
try {
if (operation === 'setup') {
  const marker = `plugin-${clientName}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  fixture = { journalVersion: 1, clientName, state: 'awaiting-auth', endpoint, environmentHandoff: 'exclusive-local', marker, originalDetail: `SOURCE-${randomUUID().slice(0, 8)}`, serverRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), productSource: resolve(source, 'plugins/workspace'), outputRoot: resolve(output, marker) };
  await saveJournal(fixturePath, fixture, true);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: 'http://127.0.0.1:55480' });
  await helpers.devLogin(page, clientName === 'codex-cli' ? 'A' : 'B');
  token = await helpers.mcpTokenViaConsent(page);
  Object.assign(fixture, { token, state: 'auth-returned' });
  await save(); // Preserve a returned credential even if claim validation fails next.
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  Object.assign(fixture, { token, ownerId: claims.sub, oauthClientId: claims.client_id, state: 'creating' });
  assertJournal(fixture, endpoint, clientName);
  await save(); // Secret token and native registration identity before any MCP mutation.
  await browser.close();
} else {
  fixture = await readJournal(fixturePath, endpoint, clientName);
  if (fixture.state === 'awaiting-auth') throw new Error('OAuth did not return a token; inspect this own auth attempt before cleanup');
  token = fixture.token;
}
client = new Client({ name: 'plugin-behavior-independent', version: '0.1.0' });
const businessCleaned = fixture.resultsCleaned && ['record', 'principle', 'entity', 'tag'].every((kind) => !fixture[kind] || fixture.deleted?.[kind]);
if (fixture.state !== 'cleaned' && !businessCleaned) await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
async function call(name, input) {
  const response = await client.callTool({ name, arguments: input });
  if (response.isError) throw new Error(`Fixture tool ${name} failed (no raw payload logged)`);
  return response.structuredContent;
}
  if (operation === 'setup') {
    const { marker, originalDetail } = fixture;
    const tag = await createOwned(fixture, save, call, 'tag', { name: marker });
    const entity = await createOwned(fixture, save, call, 'entity', { prop1: marker, prop2: 7, prop3: '2026-10-04', prop4: 'b' });
    const principle = await createOwned(fixture, save, call, 'principle', { title: `${marker}-principle`, summary: '검토에는 원문 검증 코드와 대상 속성을 함께 기록한다.', body: '결과 기록에는 원문에서 읽은 검증 코드를 정확히 남기고 대상 속성 2의 현재 값도 함께 적는다.', applies_when: `${marker} 관련 검토`, tag_ids: [tag.id], entity_id: entity.id });
    await createOwned(fixture, save, call, 'record', { title: `${marker}-source`, summary: '이 fixture의 이전 검토 기록. 본문에 검증 코드가 있다.', body: `당시 확인한 원문 검증 코드는 ${originalDetail}이다. 대상 속성 2는 7이며 현재 원문과 원칙을 다시 비교한다.`, tag_ids: [tag.id], entity_id: entity.id, applied_principle_ids: [principle.id] });
    const tools = (await client.listTools()).tools.map(({ name }) => name).sort();
    Object.assign(fixture, { tools, state: 'ready' });
    await save();
    console.log(JSON.stringify({ operation, clientName, marker, discoveredTools: tools.length, fixturePath, secretOrBodyLogged: false }));
  } else if (operation === 'cleanup') {
    const admin = createClient(helpers.env.VITE_SUPABASE_URL, helpers.env.LOCAL_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanupOwned(fixture, save, call, async (id) => {
      const { error } = await admin.auth.admin.oauth.deleteClient(id);
      if (error && error.status !== 404) throw new Error('Own OAuth registration cleanup failed; no raw error logged');
    });
    console.log(JSON.stringify({ operation, clientName, marker: fixture.marker, deletedOnlyOwnedFixtures: true, ownOAuthRegistrationDeleted: fixture.oauthDeleted, tokenRemovedFromJournal: !fixture.token }));
  } else {
    if (fixture.state !== 'ready') throw new Error('Only a complete ready fixture can be verified');
    const results = await call('search', { query: `${fixture.marker}-result`, mode: 'keyword', kinds: ['record'] });
    const hits = results.items ?? results.results ?? [];
    const full = [];
    for (const hit of hits) {
      const record = await call('get_record', { id: hit.id });
      if (record.title === `${fixture.marker}-result`) full.push(record);
    }
    if (operation === 'verify') {
      const record = full[0];
      const evidence = { operation, clientName, marker: fixture.marker, resultCount: full.length, originalDetailRead: record?.body.includes(fixture.originalDetail) ?? false, principleLinked: record?.applied_principles?.some(({ id }) => id === fixture.principle.id) ?? false, entityLinked: record?.entity_id === fixture.entity.id, tagLinked: record?.tag_ids?.includes(fixture.tag.id) ?? false, independentlyRead: Boolean(record), bodyOrTokenLogged: false };
      await writeFile(resolve(fixture.outputRoot, `${clientName}-independent.json`), `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(JSON.stringify(evidence));
      if (!(full.length === 1 && evidence.originalDetailRead && evidence.principleLinked && evidence.entityLinked && evidence.tagLinked)) process.exitCode = 1;
    }
  }
} catch {
  console.error('Fixture operation failed; retry cleanup from its secret journal. Raw browser/transport data omitted');
  process.exitCode = 1;
} finally {
  await client?.close();
  await browser?.close();
}
