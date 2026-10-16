// Root runs serially against its allocated services. Business mutations use UI/CLI only.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readJournal, saveJournal } from './journal.mjs';
import { connectRoundtrip } from './roundtrip-session.mjs';
import { readBusinessOriginals } from './preparation.mjs';
import { beginRoundtripPhase, finishRoundtripPhase, digestRoundtrip } from './roundtrip.mjs';
import { outsideDirectory } from './files.mjs';
import { webFieldLabel, webFailureDiagnostic } from './web-proof.mjs';

const [source, fixturePath] = process.argv.slice(2);
if (!source || !fixturePath || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local' || !/^[a-f0-9]{40}$/.test(process.env.PREPARATION_BACKEND_REVISION ?? '')) throw new Error('Usage: allocated handoff web-roundtrip.mjs <allocated-source> <outside-fixture.json>');
const helpers = await import(pathToFileURL(resolve(source, 'e2e/support.ts')).href);
const { readLocalConfig } = await import(pathToFileURL(resolve(source, 'scripts/local-config.mjs')).href);
const { chromium, expect } = await import(pathToFileURL(resolve(source, 'node_modules/@playwright/test/index.mjs')).href);
const { scalarFixtureType } = await import(pathToFileURL(resolve(source, 'e2e/entity-schema-support.ts')).href);
const { beginTabAction, openDetailEditor, saveOnce } = await import(pathToFileURL(resolve(source, 'e2e/ui-actions.ts')).href);
const { webUrl } = readLocalConfig(pathToFileURL(resolve(source, 'supabase/config.toml')));
let f = await readJournal(fixturePath, helpers.MCP_URL, JSON.parse(await readFile(fixturePath, 'utf8')).clientName);
if (f.state !== 'ready' || !f.roundtrip || f.roundtrip.completed.length || f.roundtrip.pending) throw new Error('Only fresh roundtrip journal; interrupted phases require original reconciliation/cleanup, never blind replay');
let client, call, browser, page;
const save = () => saveJournal(fixturePath, f);
const output = await outsideDirectory(resolve(f.outputRoot, 'roundtrip'));
const evidence = { client: f.clientName, backendAllocatedRevision: process.env.PREPARATION_BACKEND_REVISION, phases: [], desktopViewport: { width: 1280, height: 900 }, mobileViewport: { width: 390, height: 844 }, actualDesktopApp: false, physicalMobile: false, cliNativeOAuth: false, sdkBusinessBootstrap: false, rawAuthOrBodiesLogged: false };
async function persistEvidence() { await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); }
async function webPhase(mode, intent, path, action) {
  evidence.phase = mode; evidence.stage = 'baseline';
  const before = await readBusinessOriginals(call);
  evidence.stage = 'journal-intent';
  await beginRoundtripPhase(f, save, before, mode, intent);
  // Record the UI's own request identity before forwarding its real mutation.
  // This route never substitutes a response, changes a request, or retries it.
  const match = url => new URL(url).pathname.endsWith(`/api${path}`);
  const method = mode === 'web-memo' ? 'PATCH' : 'POST';
  const creating = ['web-entity', 'web-source'].includes(mode);
  await page.route(match, async route => {
    const request = route.request();
    if (request.method() === method) {
      const input = request.postDataJSON();
      if (!input?.request_key || (!creating && !input?.expected_version)) throw new Error('Real web commit lacks object identity/version');
      f.roundtrip.pending.webMutation = { path, request_key: input.request_key, ...(!creating ? { expected_version: input.expected_version } : {}) }; await save();
    }
    await route.continue();
  });
  try {
    evidence.stage = 'ui-commit';
    const [response] = await Promise.all([page.waitForResponse(r => match(r.url()) && r.request().method() === method), action()]);
    if (!response.ok()) throw new Error('Real web commit failed; no response body logged');
    evidence.stage = 'verify-originals';
    const after = await readBusinessOriginals(call);
    const proof = await finishRoundtripPhase(f, save, after);
    evidence.phases.push({ mode, writer: 'real-web-ui', requestIdObserved: true, proof }); await persistEvidence();
    if (!proof.pass) throw new Error('Independent web contract mismatch');
    if (mode === 'web-entity') f.entity = after.entities.find(r => r.id === proof.targetId);
    if (mode === 'web-source') f.record = after.records.find(r => r.id === proof.targetId);
    if (mode === 'web-complete') { f.task = after.tasks.find(r => r.id === f.task.id); f.roundtrip.result = after.records.find(r => r.id === f.task.result_record_id); }
    if (mode === 'web-memo') f.roundtrip.result = after.records.find(r => r.id === intent.id);
    await save();
  } finally { await page.unroute(match); }
}
async function nativePhase(mode, intent) {
  evidence.phase = mode; evidence.stage = 'native-start';
  f.roundtrip.intent = intent; await save();
  const script = resolve(import.meta.dirname, 'run-client.mjs');
  const child = spawn(process.execPath, [script, f.clientName, fixturePath, mode], { cwd: resolve(import.meta.dirname, '../..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let location, bytes = 0;
  // Native runner stdout is structural only; retain just its evidence-file path.
  let buffer = '';
  child.stdout.on('data', chunk => {
    bytes += chunk.length; if (bytes > 1000000) { child.kill(); return; }
    buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { try { const v = JSON.parse(line); if (v.evidence) location = v.evidence; } catch { /* no raw output */ } }
  });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 300000);
  let exit;
  evidence.stage = 'native-await';
  try { exit = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }); }
  finally { clearTimeout(timer); }
  f = await readJournal(fixturePath, helpers.MCP_URL, f.clientName);
  evidence.stage = 'native-assessment';
  const native = location ? JSON.parse(await readFile(location, 'utf8')) : null;
  evidence.phases.push({ mode, writer: mode.endsWith('-read') ? 'new-native-read-session' : 'real-native-cli', exit, evidencePath: location ?? null, assessment: native?.assessment ?? null }); await persistEvidence();
  if (exit !== 0 || !native?.assessment?.pass || f.roundtrip.pending) throw new Error('Native phase failed; retain original evidence, no blind retry');
}
async function readWeb(mode, action) {
  evidence.phase = mode; evidence.stage = 'baseline';
  const before = await readBusinessOriginals(call);
  evidence.stage = 'ui-reread';
  await action();
  evidence.stage = 'verify-originals';
  const after = await readBusinessOriginals(call);
  const unchanged = digestRoundtrip(before) === digestRoundtrip(after);
  evidence.phases.push({ mode, writer: 'read-only-web', unchanged }); await persistEvidence();
  if (!unchanged) throw new Error('Web reread changed stored originals');
}
async function fields(form, value) {
  const fieldCodes = { 이메일: 'email', 비밀번호: 'password', 수량: 'quantity', 날짜: 'date', 제목: 'title', 본문: 'body' };
  for (const [label, text] of Object.entries(value)) { evidence.stage = `field-${fieldCodes[label] ?? 'known-input'}`; await form.getByLabel(webFieldLabel(label)).fill(text); }
  evidence.stage = 'fields-complete';
}
async function commitMemo(form, body, label = '저장') {
  evidence.stage = 'change-note';
  await form.getByLabel(webFieldLabel('편집 메모')).fill(body);
  evidence.stage = 'single-save';
  await form.getByRole('button', { name: label, exact: true }).click();
}

try {
  evidence.phase = 'initialization'; evidence.stage = 'independent-connect';
  ({ client, call } = await connectRoundtrip(f));
  evidence.stage = 'browser-launch';
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ baseURL: webUrl, viewport: evidence.desktopViewport });
  page.setDefaultTimeout(20000);
  evidence.phase = 'web-login'; evidence.stage = 'navigate';
  await page.goto('/login'); await fields(page, { 이메일: f.authEmail, 비밀번호: f.authPassword });
  evidence.stage = 'submit'; await page.getByRole('button', { name: '이메일로 로그인', exact: true }).click();
  evidence.stage = 'await-login'; await page.waitForURL(u => u.pathname !== '/login');
  f.entityType = await scalarFixtureType({ call }); await save();
  evidence.explicitScalarTypeProvisioning = true;
  await webPhase('web-entity', {}, '/entities', async () => {
    await page.goto(`/entities?entity_type_id=${f.entityType.id}`); await beginTabAction(page, '검사 자료 추가');
    const form = page.getByRole('dialog', { name: `${f.entityType.label} 추가`, exact: true });
    await fields(form, { 제목: f.marker, 수량: '7', 날짜: '2026-10-06' }); await form.getByLabel(webFieldLabel('분류')).selectOption('b');
    await saveOnce(page, form); await expect(form).not.toBeVisible();
  });
  await webPhase('web-source', { body: `${f.originalDetail}; 당시 속성2=7; 초기 기준에서는 보류` }, '/records', async () => {
    await page.goto('/records'); await beginTabAction(page, '기록 작성'); const form = page.getByRole('dialog', { name: '기록 작성', exact: true });
    await fields(form, { 본문: f.roundtrip.intent.body });
    await form.getByRole('checkbox', { name: f.marker, exact: true }).check(); await saveOnce(page, form); await expect(form).not.toBeVisible();
  });
  await nativePhase('roundtrip-entity', { id: f.entity.id, memoBody: `${f.originalDetail}; 속성2 7에서 11로 변경; ENTITY-${randomUUID()}` });
  await readWeb('desktop-entity-final-memo', async () => {
    const webResponse = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/api/entities/${encodeURIComponent(f.entity.id)}`));
    await page.goto(`/entities/${encodeURIComponent(f.entity.id)}`); await openDetailEditor(page); await expect(page.getByRole('dialog', { name: `${f.entityType.label} 편집`, exact: true }).getByLabel(webFieldLabel('수량'))).toHaveValue('11');
    const row = await (await webResponse).json();
    if (row.id !== f.entity.id || row.version !== f.entity.version || row.properties.prop_2 !== 11) throw new Error('Actual web entity identity/version mismatch');
    evidence.webEntity = { sameId: true, sameVersion: true, version: row.version };
    const all = await readBusinessOriginals(call), memo = all.records.find(r => r.change?.target_id === f.entity.id && r.change.action === 'update');
    await page.goto(`/records/${memo.id}`); await expect(page.locator('main')).toContainText(f.roundtrip.intent.memoBody);
  });
  await nativePhase('roundtrip-task', { body: '속성2가 11인지 확인하고 결과를 남긴다' });
  await webPhase('web-complete', { id: f.task.id, body: `속성2=11 확인 완료; RESULT-${randomUUID()}` }, `/tasks/${f.task.id}/complete`, async () => {
    await page.goto(`/tasks/${f.task.id}`); await page.getByRole('button', { name: '완료하고 기록', exact: true }).click(); const form = page.getByRole('dialog', { name: '할 일 완료', exact: true });
    await fields(form, { 본문: f.roundtrip.intent.body });
    await form.getByRole('button', { name: '완료하고 기록 저장', exact: true }).click(); await expect(form).not.toBeVisible();
  });
  await nativePhase('roundtrip-task-read', {});
  await webPhase('web-memo', { id: f.roundtrip.result.id, body: `왕복 확인 완료: 속성2=11; MEMO-${randomUUID()}` }, `/records/${f.roundtrip.result.id}`, async () => {
    await page.goto(`/records/${f.roundtrip.result.id}`); await openDetailEditor(page); const form = page.getByRole('dialog', { name: '기록 편집', exact: true });
    await fields(form, { 본문: f.roundtrip.intent.body }); await saveOnce(page, form); await expect(form).not.toBeVisible();
  });
  await readWeb('desktop-exact-source-reopening', async () => { await page.goto(`/records/${f.record.id}`); await expect(page.locator('main')).toContainText(f.record.body); });
  await page.setViewportSize(evidence.mobileViewport);
  await readWeb('mobile-result-and-current-reread', async () => {
    await page.goto(`/entities/${encodeURIComponent(f.entity.id)}`); await openDetailEditor(page); await expect(page.getByRole('dialog', { name: `${f.entityType.label} 편집`, exact: true }).getByLabel(webFieldLabel('수량'))).toHaveValue('11');
    await page.goto('/tasks');
    const taskLink = page.getByRole('link', { name: f.task.title, exact: true });
    await expect(page.getByRole('listitem').filter({ has: taskLink }).getByText('완료', { exact: true })).toBeVisible();
    await taskLink.click(); await expect(page.locator('main')).toContainText(f.task.body);
    await page.goto(`/records/${f.roundtrip.result.id}`); await expect(page.locator('main')).toContainText(f.roundtrip.result.body);
    await page.goto(`/records/${f.record.id}`); await expect(page.locator('main')).toContainText(f.record.body);
  });
  evidence.pass = true;
} catch (error) {
  evidence.pass = false; evidence.failure = { phase: evidence.phase, stage: evidence.stage, ...webFailureDiagnostic(error), pending: Boolean(f.roundtrip.pending) }; process.exitCode = 1;
} finally {
  try { await persistEvidence(); } finally { try { await browser?.close(); } finally { await client?.close(); } }
}
console.log(JSON.stringify({ pass: evidence.pass, evidence: resolve(output, 'evidence.json'), cleanupRequired: true }));
