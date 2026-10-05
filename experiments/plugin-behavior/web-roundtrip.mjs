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

const [source, fixturePath] = process.argv.slice(2);
if (!source || !fixturePath || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local' || !/^[a-f0-9]{40}$/.test(process.env.PREPARATION_BACKEND_REVISION ?? '')) throw new Error('Usage: allocated handoff web-roundtrip.mjs <allocated-source> <outside-fixture.json>');
const helpers = await import(pathToFileURL(resolve(source, 'e2e/support.ts')).href);
const { readLocalConfig } = await import(pathToFileURL(resolve(source, 'scripts/local-config.mjs')).href);
const { chromium, expect } = await import(pathToFileURL(resolve(source, 'node_modules/@playwright/test/index.mjs')).href);
const { beginTabAction, openDetailEditor, saveWithMemo } = await import(pathToFileURL(resolve(source, 'e2e/ui-actions.ts')).href);
const { webUrl } = readLocalConfig(pathToFileURL(resolve(source, 'supabase/config.toml')));
let f = await readJournal(fixturePath, helpers.MCP_URL, JSON.parse(await readFile(fixturePath, 'utf8')).clientName);
if (f.state !== 'ready' || !f.roundtrip || f.roundtrip.completed.length || f.roundtrip.pending) throw new Error('Only fresh roundtrip journal; interrupted phases require original reconciliation/cleanup, never blind replay');
let client, call, browser, page;
const save = () => saveJournal(fixturePath, f);
const output = await outsideDirectory(resolve(f.outputRoot, 'roundtrip'));
const evidence = { client: f.clientName, backendAllocatedRevision: process.env.PREPARATION_BACKEND_REVISION, phases: [], desktopViewport: { width: 1280, height: 900 }, mobileViewport: { width: 390, height: 844 }, actualDesktopApp: false, physicalMobile: false, cliNativeOAuth: false, sdkBusinessBootstrap: false, rawAuthOrBodiesLogged: false };
async function persistEvidence() { await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); }
async function webPhase(mode, intent, path, action) {
  const before = await readBusinessOriginals(call);
  await beginRoundtripPhase(f, save, before, mode, intent);
  // Record the UI's own request identity before forwarding its real mutation.
  // This route never substitutes a response, changes a request, or retries it.
  const match = url => new URL(url).pathname.endsWith(`/api${path}`);
  const method = mode === 'web-memo' ? 'PATCH' : 'POST';
  await page.route(match, async route => {
    const request = route.request();
    if (request.method() === method) {
      const input = request.postDataJSON();
      if (!input?.request_id) throw new Error('Real web commit lacks request identity');
      f.roundtrip.pending.webRequestId = input.request_id; await save();
    }
    await route.continue();
  });
  try {
    const [response] = await Promise.all([page.waitForResponse(r => match(r.url()) && r.request().method() === method), action()]);
    if (!response.ok()) throw new Error('Real web commit failed; no response body logged');
    const after = await readBusinessOriginals(call);
    const proof = await finishRoundtripPhase(f, save, after);
    evidence.phases.push({ mode, writer: 'real-web-ui', requestIdObserved: true, proof }); await persistEvidence();
    if (!proof.pass) throw new Error('Independent web contract mismatch');
    if (mode === 'web-entity') f.entity = after.entities.find(r => r.id === proof.targetId);
    if (mode === 'web-source') f.record = after.records.find(r => r.id === proof.targetId);
    if (mode.startsWith('web-principle') && mode !== 'web-principle-delete') f.principle = after.principles.find(r => r.id === proof.targetId);
    if (mode === 'web-complete') { f.task = after.tasks.find(r => r.id === f.task.id); f.roundtrip.result = after.records.find(r => r.id === f.task.result_record_id); }
    if (mode === 'web-memo') f.roundtrip.result = after.records.find(r => r.id === intent.id);
    await save();
  } finally { await page.unroute(match); }
}
async function nativePhase(mode, intent) {
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
  try { exit = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }); }
  finally { clearTimeout(timer); }
  f = await readJournal(fixturePath, helpers.MCP_URL, f.clientName);
  const native = location ? JSON.parse(await readFile(location, 'utf8')) : null;
  evidence.phases.push({ mode, writer: mode.endsWith('-read') ? 'new-native-read-session' : 'real-native-cli', exit, evidencePath: location ?? null, assessment: native?.assessment ?? null }); await persistEvidence();
  if (exit !== 0 || !native?.assessment?.pass || f.roundtrip.pending) throw new Error('Native phase failed; retain original evidence, no blind retry');
}
async function readWeb(mode, action) {
  const before = await readBusinessOriginals(call);
  await action();
  const after = await readBusinessOriginals(call);
  const unchanged = digestRoundtrip(before) === digestRoundtrip(after);
  evidence.phases.push({ mode, writer: 'read-only-web', unchanged }); await persistEvidence();
  if (!unchanged) throw new Error('Web reread changed stored originals');
}
async function fields(form, value) { for (const [label, text] of Object.entries(value)) await form.getByLabel(label, { exact: true }).fill(text); }
async function commitMemo(form, body, label = '저장') {
  await form.getByRole('button', { name: '기록 메모 확인', exact: true }).click();
  await form.getByLabel('기록 본문', { exact: true }).fill(body);
  await form.getByRole('button', { name: label === '삭제' ? '삭제' : '확인하고 저장', exact: true }).click();
}
try {
  ({ client, call } = await connectRoundtrip(f));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ baseURL: webUrl, viewport: evidence.desktopViewport });
  page.setDefaultTimeout(20000);
  await page.goto('/login'); await fields(page, { 이메일: f.authEmail, 비밀번호: f.authPassword });
  await page.getByRole('button', { name: '이메일로 로그인', exact: true }).click(); await page.waitForURL(u => u.pathname !== '/login');
  await webPhase('web-entity', {}, '/entities', async () => {
    await page.goto('/entities'); await beginTabAction(page, '엔터티 추가');
    const form = page.getByRole('dialog', { name: '엔터티 추가', exact: true });
    await fields(form, { '속성 1': f.marker, '속성 2': '7', '속성 3': '2026-10-06' }); await form.getByLabel('속성 4').selectOption('b');
    await saveWithMemo(page, form); await expect(form).not.toBeVisible();
  });
  await webPhase('web-principle', { body: '초기 조건: 속성2가 7이면 보류' }, '/principles/current', async () => {
    await page.goto('/principles'); await beginTabAction(page, '현재 원칙 등록');
    const form = page.getByRole('dialog', { name: '현재 원칙 등록', exact: true });
    await fields(form, { 제목: `${f.marker}-principle`, 요약: '현재 판단 기준', 본문: f.roundtrip.intent.body });
    await saveWithMemo(page, form); await expect(form).not.toBeVisible();
  });
  await webPhase('web-source', { body: `${f.originalDetail}; 당시 속성2=7; 초기 기준에서는 보류` }, '/records', async () => {
    await page.goto('/records'); await beginTabAction(page, '기록 작성'); const form = page.getByRole('dialog', { name: '기록 작성', exact: true });
    await fields(form, { 제목: `${f.marker}-source`, 요약: `${f.originalDetail} 당시 조건`, 본문: f.roundtrip.intent.body });
    await form.getByRole('checkbox', { name: f.marker, exact: true }).check(); await saveWithMemo(page, form); await expect(form).not.toBeVisible();
  });
  await nativePhase('roundtrip-entity', { id: f.entity.id, memoBody: `${f.originalDetail}; 속성2 7에서 11로 변경; ENTITY-${randomUUID()}` });
  await readWeb('desktop-entity-final-memo', async () => {
    const webResponse = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/api/entities/${f.entity.id}`));
    await page.goto(`/entities/${f.entity.id}`); await expect(page.getByRole('dialog', { name: '엔터티 편집', exact: true }).getByLabel('속성 2')).toHaveValue('11');
    const row = await (await webResponse).json();
    if (row.id !== f.entity.id || row.version !== f.entity.version || row.prop2 !== 11) throw new Error('Actual web entity identity/version mismatch');
    evidence.webEntity = { sameId: true, sameVersion: true, version: row.version };
    const all = await readBusinessOriginals(call), memo = all.records.find(r => r.change?.target_id === f.entity.id && r.change.action === 'update');
    await page.goto(`/records/${memo.id}`); await expect(page.locator('main')).toContainText(f.roundtrip.intent.memoBody);
  });
  await nativePhase('roundtrip-task', { summary: '왕복 검증 후 값 확인', body: '속성2가 11인지 확인하고 결과를 남긴다' });
  await webPhase('web-complete', { id: f.task.id, body: `속성2=11 확인 완료; RESULT-${randomUUID()}` }, `/tasks/${f.task.id}/complete`, async () => {
    await page.goto(`/tasks/${f.task.id}`); await page.getByRole('button', { name: '완료', exact: true }).click(); const form = page.getByRole('dialog', { name: '할 일 완료', exact: true });
    await fields(form, { 제목: `${f.marker}-result`, 요약: '대상 값 확인 완료', 본문: f.roundtrip.intent.body });
    await form.getByRole('button', { name: '완료하고 기록 저장', exact: true }).click(); await expect(form).not.toBeVisible();
  });
  await nativePhase('roundtrip-task-read', {});
  await webPhase('web-memo', { id: f.roundtrip.result.id, body: `왕복 확인 완료: 속성2=11; MEMO-${randomUUID()}` }, `/records/${f.roundtrip.result.id}`, async () => {
    await page.goto(`/records/${f.roundtrip.result.id}`); await openDetailEditor(page); const form = page.getByRole('dialog', { name: '기록 편집', exact: true });
    await fields(form, { 본문: f.roundtrip.intent.body }); await saveWithMemo(page, form); await expect(form).not.toBeVisible();
  });
  await webPhase('web-principle-update', { id: f.principle.id, body: '현재 조건: 속성2가 11이면 진행', memoBody: `현재 기준 변경; PRINCIPLE-${randomUUID()}` }, '/principles/current', async () => {
    await page.goto(`/principles/${f.principle.id}`); await openDetailEditor(page); const form = page.getByRole('dialog', { name: '현재 원칙 편집', exact: true });
    await fields(form, { 본문: f.roundtrip.intent.body }); await commitMemo(form, f.roundtrip.intent.memoBody); await expect(form).not.toBeVisible();
  });
  await nativePhase('roundtrip-principle-read', {});
  await readWeb('desktop-exact-source-reopening', async () => { await page.goto(`/records/${f.record.id}`); await expect(page.locator('main')).toContainText(f.record.body); });
  await page.setViewportSize(evidence.mobileViewport);
  await readWeb('mobile-result-and-current-reread', async () => {
    await page.goto(`/entities/${f.entity.id}`); await expect(page.getByRole('dialog', { name: '엔터티 편집', exact: true }).getByLabel('속성 2')).toHaveValue('11');
    await page.goto(`/tasks/${f.task.id}`); await expect(page.getByText('완료', { exact: true }).first()).toBeVisible();
    await page.goto(`/records/${f.roundtrip.result.id}`); await expect(page.locator('main')).toContainText(f.roundtrip.result.body);
    await page.goto(`/principles/${f.principle.id}`); await expect(page.locator('main')).toContainText(f.principle.body);
    await page.goto(`/records/${f.record.id}`); await expect(page.locator('main')).toContainText(f.record.body);
  });
  await page.setViewportSize(evidence.desktopViewport);
  await webPhase('web-principle-delete', { id: f.principle.id }, `/principles/${f.principle.id}/delete`, async () => {
    await page.goto(`/principles/${f.principle.id}?edit=1`); await page.getByRole('button', { name: '삭제', exact: true }).click();
    const form = page.getByRole('dialog', { name: '원칙을 삭제할까요?', exact: true }); await expect(form).toContainText('과거 원칙을 자동 승격하지 않습니다'); await saveWithMemo(page, form, '삭제'); await expect(form).not.toBeVisible();
  });
  await readWeb('current-empty-source-still-exact', async () => {
    await page.goto('/principles'); await expect(page.locator('main')).toContainText('현재 원칙이 없습니다');
    await page.goto(`/records/${f.record.id}`); await expect(page.locator('main')).toContainText(f.record.body);
  });
  evidence.pass = true;
} catch {
  evidence.pass = false; evidence.failure = 'phase-failed; inspect structural phase evidence and retain owned journal for reconciliation/cleanup'; process.exitCode = 1;
} finally {
  try { await persistEvidence(); } finally { try { await browser?.close(); } finally { await client?.close(); } }
}
console.log(JSON.stringify({ pass: evidence.pass, evidence: resolve(output, 'evidence.json'), cleanupRequired: true }));
