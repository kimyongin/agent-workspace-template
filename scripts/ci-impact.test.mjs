import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { classifyChanges, comparisonRange, presentationCss, presentationTsx } from "./ci-impact.mjs";

const change = (path, before, after, status = "M") => ({ path, before, after, status });
const mode = (...changes) => classifyChanges(changes).mode;
const component = 'export const View = () => <button className="old" title="Old" onClick={save}>Old text</button>;';

test("only static JSX text/intrinsic display attributes qualify; AST behavior and comments stay exact", () => {
  assert.equal(presentationTsx(component, component.replaceAll("Old", "New")), true);
  for (const after of [
    component.replace("{save}", "{remove}"), component.replace("button", "a"),
    component.replace("Old text", "<span>Old text</span>"), component.replace("Old text", "{label}"),
    component.replace('title="Old"', "title={label}"), component.replace("const View", "const Other"),
    `/* @jsx other */${component}`, component.replace("</button>", ""),
  ]) assert.equal(presentationTsx(component, after), false, after);
  for (const attribute of ["href", "to", "type", "value", "disabled", "id", "name", "role", "tabIndex", "aria-hidden"]) {
    const before = component.replace('title="Old"', `${attribute}="old"`);
    assert.equal(presentationTsx(before, before.replace(`${attribute}="old"`, `${attribute}="new"`)), false, attribute);
  }
  assert.equal(presentationTsx('<Widget title="Old" />', '<Widget title="New" />'), false);
  assert.equal(presentationTsx('<Widget>Old</Widget>', '<Widget>New</Widget>'), false);
  assert.equal(presentationTsx('<my-widget title="Old">Old</my-widget>', '<my-widget title="New">New</my-widget>'), false);
  assert.equal(presentationTsx('<>Old</>', '<>New</>'), false);
  assert.equal(presentationTsx('<script>old</script>', '<script>new</script>'), false);
  assert.equal(presentationTsx('<style>old</style>', '<style>new</style>'), false);
  assert.equal(presentationTsx('<div dangerouslySetInnerHTML={html}>old</div>', '<div dangerouslySetInnerHTML={html}>new</div>'), false);
});

test("input children and class names cannot bypass full verification; safe display labels still qualify", () => {
  for (const tag of ["option", "textarea", "select", "input"]) {
    const before = `<${tag}>public</${tag}>`, after = `<${tag}>private</${tag}>`;
    assert.equal(presentationTsx(before, after), false, tag);
    assert.equal(mode(change('src/features/activity/forms.tsx', before, after)), 'full', tag);
  }
  for (const className of ["visually-hidden", "hidden", "other-layout"]) {
    const after = component.replace('className="old"', `className="${className}"`);
    assert.equal(presentationTsx(component, after), false, className);
    assert.equal(mode(change('src/components/Field.tsx', component, after)), 'full', className);
  }
  assert.equal(presentationTsx('<input placeholder="Old" aria-label="Old" />', '<input placeholder="New" aria-label="New" />'), false);
  assert.equal(presentationTsx(component, component.replace("Old text", "New text")), true);
});

test("strict custom/input/fragment ancestry propagates through nested DOM text and attributes", () => {
  for (const wrap of [
    (body) => `<Widget>${body}</Widget>`,
    (body) => `<select><option>${body}</option></select>`,
    (body) => `<textarea>${body}</textarea>`,
    (body) => `<>${body}</>`,
    (body) => `<div><Widget>${body}</Widget></div>`,
  ]) {
    for (const [before, after] of [
      [wrap('<span>public</span>'), wrap('<span>private</span>')],
      [wrap('<div><span title="public">same</span></div>'), wrap('<div><span title="private">same</span></div>')],
    ]) {
      assert.equal(presentationTsx(before, after), false, after);
      assert.equal(mode(change('src/components/Field.tsx', before, after)), 'full', after);
    }
  }
  assert.equal(presentationTsx('<div><span title="Old">public</span></div>', '<div><span title="New">private</span></div>'), true);
});

test("CSS position spacing is presentation but auth/state/hiding/external/selector/token changes are full", () => {
  assert.equal(presentationCss('.button { margin-left: 1rem; gap: 4px; }', '.button { margin-left: 2rem; gap: 8px; }'), true);
  const app = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
  assert.equal(presentationCss(app, app.replace('margin-right: auto;', 'margin-right: 1rem;')), true);
  for (const [before, after] of [
    ['.login { margin: 1px; }', '.login { margin: 2px; }'],
    ['.button:hover { color: red; }', '.button:hover { color: blue; }'],
    ['.button { display: flex; }', '.button { display: none; }'],
    ['.button { opacity: 1; }', '.button { opacity: 0; }'],
    ['.button { gap: 1px; }', '.other { gap: 2px; }'],
    [':root { --space: 1px; }', ':root { --space: 2px; }'],
    ['.button { color: red; }', '.button { color: url(https://other); }'],
    ['.button { color: red; }', '.button { color: blue; pointer-events: none; }'],
  ]) assert.equal(presentationCss(before, after), false, after);
});

test("docs artifacts including HTML markup/script/style are docs; runtime files and mixed edits stay full", () => {
  const before = '<p>Old</p>', after = '<section><p>New</p></section><script>run()</script><style>p{color:red}</style>';
  assert.equal(mode(change('docs/overview.html', before, after)), 'docs');
  assert.equal(mode(change('docs/new.html', null, after, 'A')), 'docs');
  assert.equal(mode(change('docs/old.md', before, null, 'D')), 'docs');
  assert.equal(classifyChanges([{status:'R100',oldPath:'docs/old.html',path:'docs/new.html'}]).mode, 'docs');
  assert.equal(classifyChanges([{status:'R100',oldPath:'src/page.html',path:'docs/new.html'}]).mode, 'full');
  for (const extension of ['md','html','txt','svg','png','jpg','jpeg','webp','gif','pdf']) assert.equal(mode(change(`docs/assets/example.${extension}`,before,after)), 'docs');
  for (const path of ['docs/config.json','docs/check.mjs','docs/tool.ts','docs/run.sh','docs/config.yaml','plugins/workspace/README.md','plugins/workspace/skills/workspace/SKILL.md']) assert.equal(mode(change(path,before,after)), 'full', path);
  assert.equal(mode(change('docs/overview.html',before,after),change('src/lib/api.ts','old','new')), 'full');
  assert.equal(mode(change('docs/overview.html',before,after),change('.github/workflows/ci.yml','old','new')), 'full');
});

test("classification defaults full for auth/config/data/tooling/mixed runtime/delete/rename/missing source", () => {
  assert.equal(mode(change('docs/guide.md', 'old', 'new')), 'docs');
  assert.equal(mode(change('docs/new.md', null, 'new', 'A')), 'docs');
  assert.equal(mode(change('src/features/activity/TasksPage.tsx', component, component.replace("Old text", "New text"))), 'presentation');
  for (const path of ['src/features/auth/LoginPage.tsx', 'src/app/App.tsx', 'src/lib/api.ts', 'supabase/functions/api/index.ts', 'package.json', '.github/workflows/ci.yml', 'scripts/check-docs.mjs']) {
    assert.equal(mode(change(path, component, component.replace("Old text", "New text"))), 'full', path);
  }
  for (const status of ['R100', 'C100', 'T', 'U']) assert.equal(mode(change('docs/guide.md', 'old', 'new', status)), 'full');
  assert.equal(mode(change('src/features/activity/TasksPage.tsx', null, component, 'A')), 'full');
  assert.equal(mode(change('docs/guide.md', 'old', 'new'), change('src/lib/api.ts', 'old', 'new')), 'full');
  assert.equal(classifyChanges([], {}).mode, 'full');
  assert.equal(classifyChanges([change('docs/guide.md', 'old', 'new')], { forceFull: true }).mode, 'full');
});

test("PR compares merge-base to real head; push compares complete before/after; missing base is not guessed", () => {
  let observed;
  assert.deepEqual(comparisonRange('pull_request', { pull_request: { base: { sha: 'base' }, head: { sha: 'head' } } }, (...refs) => { observed = refs; return 'mergebase'; }), { base: 'mergebase', head: 'head' });
  assert.deepEqual(observed, ['base', 'head']);
  assert.deepEqual(comparisonRange('push', { before: 'a'.repeat(40), after: 'b'.repeat(40) }), { base: 'a'.repeat(40), head: 'b'.repeat(40) });
  assert.throws(() => comparisonRange('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }));
  assert.throws(() => comparisonRange('pull_request', {}));
});

test("CLI failure/missing history emits full; dispatch forces full; output and summary agree", () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-impact-test-'));
  try {
    const eventPath = join(dir, 'event.json'), output = join(dir, 'output'), summary = join(dir, 'summary');
    for (const eventName of ['push', 'workflow_dispatch']) {
      writeFileSync(eventPath, JSON.stringify({ before: 'f'.repeat(40), after: 'f'.repeat(40) }));
      execFileSync(process.execPath, [new URL('./ci-impact.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], { cwd: dir, env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, stdio: 'pipe' });
    }
    assert.equal(readFileSync(output, 'utf8'), 'mode=full\nmode=full\n');
    assert.match(readFileSync(summary, 'utf8'), /Full check and isolated integration required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("required jobs skip draft/canceled runs; active integration explicitly fails a failed/missing check", () => {
  const yaml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(yaml, /  check:\n    if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false/);
  assert.match(yaml, /  integration:\n    needs: check\n    if: \$\{\{ !cancelled\(\) && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\) \}\}/);
  assert.match(yaml, /\[ "\$CHECK_RESULT" = "success" \] \|\|.*exit 1/);
  assert.match(yaml, /Missing\/invalid classification.*exit 1/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /paths-ignore:|continue-on-error:/);
  const integration = yaml.slice(yaml.indexOf('  integration:'));
  for (const name of ['로컬 Supabase 준비(러너 안의 격리 DB)', 'DB 테스트', 'Edge Functions 실행', 'HTTP 계약 테스트', 'MCP 계약 테스트']) {
    assert.ok(integration.includes(`- name: ${name}\n        if: needs.check.outputs.mode == 'full'`), name);
  }
});
