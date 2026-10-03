import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assign, check, generated, sync, TABLE, validate } from "./agent-models.mjs";

const seed = JSON.parse(readFileSync(new URL(`../${TABLE}`, import.meta.url), "utf8"));
const table = () => structuredClone(seed);
const now = new Date("2026-10-03T12:00:00Z");
function options(t, extra = {}) {
  const c = t.clients["codex-desktop"];
  const m = c.models.balanced;
  return { client: "codex-desktop", tier: "balanced", effort: "medium", role: "implement", reason: "일반 구현", now, env: {}, evaluate: true,
    snapshot: { client: "codex-desktop", version: c.version, context: c.context, observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.model, efforts: m.efforts }] }, ...extra };
}

test("변경한 선택표는 양쪽 설정 drift를 거부하고 다시 생성하면 일치한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-models-"));
  const t = table();
  const sync = () => { for (const [file, content] of Object.entries(generated(t))) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); } };
  try {
    sync();
    assert.deepEqual(check(root, t), []);
    t.clients["codex-cli"].models.balanced.model = "new-model";
    t.clients["claude-cli"].models.balanced.model = "new-alias";
    assert.match(check(root, t).join(), /codex\/agents\/task-balanced/);
    assert.match(check(root, t).join(), /claude\/agents\/task-balanced/);
    sync();
    assert.deepEqual(check(root, t), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("동일 모델에서 medium/high/xhigh를 명시하고 부모 맥락을 상속하지 않는다", () => {
  const t = table();
  for (const effort of ["medium", "high", "xhigh"]) {
    const result = assign(t, options(t, { effort }));
    assert.equal(result.invocation.reasoning_effort, effort);
    assert.equal(result.invocation.fork_turns, "none");
    assert.equal(result.model, t.clients["codex-desktop"].models.balanced.model);
  }
  assert.throws(() => assign(t, options(t, { effort: undefined })), /묵시 상속/);
  const c = t.clients["codex-cli"]; const m = c.models.balanced;
  for (const effort of ["medium", "high", "xhigh"]) {
    const o = options(t, { client: "codex-cli", effort, snapshot: { client: "codex-cli", context: c.context, version: c.version, observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.model, efforts: m.efforts }] } });
    const result = assign(t, o);
    assert.ok(result.invocation.argv.includes(`model_reasoning_effort="${effort}"`));
    assert.equal(result.invocation.agent, undefined); // custom 파일이 배정 강도를 덮어쓰지 않음
  }
});

test("stale은 배정에서만 거부하고 정적 생성은 날짜가 지나도 가능하다", () => {
  const t = table();
  t.clients["codex-desktop"].checkedAt = "2026-09-26";
  assert.doesNotThrow(() => generated(t));
  assert.throws(() => assign(t, options(t)), /stale/);
  const o = options(table());
  o.snapshot.observedAt = "2026-10-01T12:00:00Z";
  assert.throws(() => assign(table(), o), /24시간/);
});

test("미지원/잘못된 등급·effort, 모델 누락·차단·실제 fallback을 거부한다", () => {
  const t = table();
  assert.throws(() => assign(t, options(t, { tier: "unknown" })), /등급/);
  assert.throws(() => assign(t, options(t, { effort: "extra-high" })), /명시/);
  for (const change of [(o) => o.snapshot.models.splice(0), (o) => o.snapshot.models[0].blocked = true, (o) => o.snapshot.models[0].actualModel = "parent-model", (o) => o.snapshot.models[0].efforts = ["low"]]) {
    const o = options(t); change(o);
    assert.throws(() => assign(t, o), /미지원|fallback/);
  }
  for (const model of ["", "inherit"]) {
    const broken = table(); broken.clients["codex-cli"].models.light.model = model;
    assert.throws(() => validate(broken), /모델 누락 또는 상속/);
  }
  const broken = table(); broken.clients["codex-cli"].models.light.defaultEffort = "unsupported";
  assert.throws(() => validate(broken), /기본 effort/);
  broken.clients["codex-cli"].models.light.defaultEffort = "low";
  broken.clients["codex-cli"].models.light.efforts.push("unsupported");
  assert.throws(() => validate(broken), /잘못된 effort/);
  const invalidTier = table(); invalidTier.clients["codex-cli"].models.invalid = invalidTier.clients["codex-cli"].models.light;
  assert.throws(() => validate(invalidTier), /잘못된 등급/);
});

test("계정/버전 변화와 평가 미완료를 거부하며 현재 baseline은 품질 promotion과 구별한다", () => {
  const t = table();
  const o = options(t); o.snapshot.context = "different-account";
  assert.throws(() => assign(t, o), /계정/);
  o.snapshot.context = t.clients["codex-desktop"].context; o.snapshot.version = "different-version";
  assert.throws(() => assign(t, o), /클라이언트/);
  const m = t.clients["codex-desktop"].models.balanced;
  m.nativeExecution = "pending";
  assert.throws(() => assign(t, options(t, { evaluate: false })), /실행 검증/);
  m.nativeExecution = "direct-confirmed"; m.executionEvidence = "티켓 smoke 증거";
  assert.equal(assign(t, options(t, { evaluate: false })).evaluation, "baseline");
  m.evaluation = "pending";
  assert.throws(() => assign(t, options(t, { evaluate: false })), /실행 검증/);
  m.evaluation = "passed";
  assert.throws(() => validate(t), /신규 후보 평가 증거/);
});

test("Claude 환경 모델 override를 거부하고 effort는 CLI 인자로 출력한다", () => {
  const t = table(); const c = t.clients["claude-cli"]; const m = c.models.balanced;
  const o = { client: "claude-cli", tier: "balanced", effort: "medium", role: "review", reason: "일반 리뷰", now, evaluate: true, env: {}, snapshot: { client: "claude-cli", version: c.version, context: c.context, observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.resolvedModel, efforts: m.efforts }] } };
  assert.equal(assign(t, o).invocation.effort, "medium");
  assert.throws(() => assign(t, { ...o, env: { CLAUDE_CODE_SUBAGENT_MODEL: "opus" } }), /충돌/);
  o.snapshot.models[0].actualModel = "claude-opus-4-6";
  assert.throws(() => assign(t, o), /실제 모델 불일치/);
  o.snapshot.models[0].actualModel = "claude-sonnet-new-version";
  assert.throws(() => assign(t, o), /실제 모델 불일치/);
  m.nativeExecution = "yes";
  assert.throws(() => validate(t), /검증 상태/);
});

test("sync는 다른 프로젝트 설정과 agents 키를 보존하고 선택 키만 맞춘다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-config-"));
  try {
    mkdirSync(path.join(root, ".codex"));
    writeFileSync(path.join(root, ".codex/config.toml"), 'model = "user-main"\n[agents]\nmax_threads = 4\ndefault_subagent_model = "old"\n[mcp_servers.example]\nurl = "https://example.com"\n');
    sync(root, table());
    const text = readFileSync(path.join(root, ".codex/config.toml"), "utf8");
    assert.match(text, /model = "user-main"/);
    assert.match(text, /max_threads = 4/);
    assert.match(text, /\[mcp_servers.example\]/);
    assert.deepEqual(check(root, table()), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("선택 근거와 역할 없이 advanced 또는 xhigh를 배정하지 않는다", () => {
  const t = table();
  assert.throws(() => assign(t, options(t, { effort: "xhigh", reason: "" })), /선택 근거/);
  assert.throws(() => assign(t, options(t, { role: "unknown" })), /역할/);
});
