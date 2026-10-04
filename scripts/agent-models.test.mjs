import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { assign, check, generated, sync, TABLE, validate } from "./agent-models.mjs";

const seed = JSON.parse(readFileSync(new URL(`../${TABLE}`, import.meta.url), "utf8"));
const table = () => {
  const fixture = structuredClone(seed);
  // Synthetic verification times keep boundary tests independent of future evidence refreshes.
  for (const client of Object.values(fixture.clients)) client.checkedAt = "2026-10-02T12:00:00Z";
  return fixture;
};
const now = new Date("2026-10-03T14:00:00Z");
function options(t, extra = {}) {
  const c = t.clients["codex-desktop"];
  const m = c.models.balanced;
  return { client: "codex-desktop", tier: "balanced", effort: "medium", role: "implement", reason: "일반 구현", now, env: {}, evaluate: true,
    snapshot: { client: "codex-desktop", version: c.version, context: c.context, timeZone: "Asia/Seoul", observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.model, efforts: m.efforts }] }, ...extra };
}

test("변경한 선택표는 양쪽 설정 drift를 거부하고 다시 생성하면 일치한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-models-"));
  const t = table();
  const sync = () => { for (const [file, content] of Object.entries(generated(t))) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); } };
  try {
    sync();
    assert.deepEqual(check(root, t), []);
    t.clients["codex-cli"].models.balanced.defaultEffort = "high";
    t.clients["claude-cli"].models.balanced.defaultEffort = "high";
    assert.match(check(root, t).join(), /codex\/agents\/task-balanced/);
    assert.match(check(root, t).join(), /claude\/agents\/task-balanced/);
    sync();
    assert.deepEqual(check(root, t), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("사용자 허용 모델 정책은 모든 등급의 check/sync/assign 및 평가에도 적용한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-allowlist-"));
  try {
    sync(root, table());
    const original = Object.entries(generated(table())).map(([file]) => [file, readFileSync(path.join(root, file))]);
    for (const client of ["codex-cli", "codex-desktop", "claude-cli"]) {
      const forbidden = client.startsWith("codex") ? ["gpt-6-astra", "gpt-5.6-sol", "gpt-6-luna"] : ["claude-fable-5-5", "claude-sonnet-4-6", "opus", "haiku"];
      for (const tier of ["light", "balanced", "advanced"]) {
        for (const model of forbidden) {
          const t = table(); t.clients[client].models[tier].model = model;
          assert.throws(() => validate(t), /허용 모델/);
          assert.throws(() => check(root, t), /허용 모델/);
          assert.throws(() => sync(root, t), /허용 모델/);
          for (const evaluate of [false, true]) assert.throws(() => assign(t, options(t, { client, tier, evaluate })), /허용 모델/);
        }
      }
    }
    for (const [file, bytes] of original) assert.deepEqual(readFileSync(path.join(root, file)), bytes);
    for (const modelPolicy of [undefined, {}, { allowedModels: {}, changeAuthority: "explicit-human-policy-change" }, { ...table().modelPolicy, changeAuthority: "automatic" }]) {
      const t = table(); t.modelPolicy = modelPolicy;
      assert.throws(() => validate(t), /허용 정책/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("허용 고정 ID의 resolved/actual 이동은 pending 평가에서도 거부한다", () => {
  for (const actualModel of ["opus", "claude-opus-4-6", "claude-opus-5-5-new", "claude-fable-5-5", "claude-sonnet-4-6"]) {
    const t = table(); const c = t.clients["claude-cli"]; const m = c.models.advanced;
    const o = options(t, { client: "claude-cli", tier: "advanced", effort: "high", snapshot: { client: "claude-cli", version: c.version, context: c.context, timeZone: "Asia/Seoul", observedAt: now.toISOString(), models: [{ model: m.model, actualModel, efforts: m.efforts }] } });
    assert.throws(() => assign(t, o), /실제 모델 불일치/);
    m.resolvedModel = actualModel;
    assert.throws(() => validate(t), /허용 모델/);
  }
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
    const o = options(t, { client: "codex-cli", effort, snapshot: { client: "codex-cli", context: c.context, version: c.version, timeZone: "Asia/Seoul", observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.model, efforts: m.efforts }] } });
    const result = assign(t, o);
    assert.ok(result.invocation.argv.includes(`model_reasoning_effort="${effort}"`));
    assert.equal(result.invocation.agent, undefined); // custom 파일이 배정 강도를 덮어쓰지 않음
  }
});

test("개발하지 않은 기간 뒤에도 기존 검증과 오늘 조회가 호환되면 배정한다", () => {
  const t = table();
  t.clients["codex-desktop"].checkedAt = "2026-08-01T13:00:00+09:00";
  assert.doesNotThrow(() => generated(t));
  assert.equal(assign(t, options(t, { evaluate: false })).evaluation, "baseline");
  const o = options(table());
  o.snapshot.observedAt = "2026-10-01T12:00:00Z";
  assert.throws(() => assign(table(), o), /현지 개발일/);
});

test("KST 자정 경계는 UTC 날짜나 rolling 24시간과 다르게 처리한다", () => {
  const t = table();
  t.clients["codex-desktop"].checkedAt = "2026-09-01T00:00:00Z";
  const o = options(t, { now: new Date("2026-10-02T15:00:00Z") }); // KST 10/03 00:00
  o.snapshot.observedAt = "2026-10-03T00:00:00+09:00";
  assert.doesNotThrow(() => assign(t, o));
  o.now = new Date("2026-10-03T14:59:59Z");
  assert.doesNotThrow(() => assign(t, o));
  o.now = new Date("2026-10-03T15:00:00Z"); // 다음 사용자 현지 날짜
  assert.throws(() => assign(t, o), /현지 개발일/);
  o.now = new Date("2026-10-02T15:00:00Z");
  o.snapshot.observedAt = "2026-10-02T14:59:59Z";
  assert.throws(() => assign(t, o), /현지 개발일/);
});

test("시각은 명시 timezone과 유효 날짜/offset을 요구하고 미래 조회를 거부한다", () => {
  for (const value of ["2026-10-03", "2026-10-03T14:00:00", "2026-02-30T12:00:00Z", "2026-10-03T24:00:00Z", "2026-10-03T12:00:60Z", "2026-10-03T12:00:00+24:00", "2026-10-03T12:00:00+09:60", "bad", undefined]) {
    const t = table(); const o = options(t); o.snapshot.observedAt = value;
    assert.throws(() => assign(t, o), /시각/);
    t.clients["codex-desktop"].checkedAt = value;
    assert.throws(() => validate(t), /시각/);
  }
  const t = table(); const o = options(t);
  o.snapshot.observedAt = "2026-10-03T14:00:01Z";
  assert.throws(() => assign(t, o), /미래/);
  t.clients["codex-desktop"].checkedAt = "2026-10-03T14:00:01Z";
  assert.throws(() => assign(t, options(t)), /미래/);
});

test("사용자 시간대 없이는 호스트 시간대로 대체하지 않는다", () => {
  const t = table();
  for (const timeZone of [undefined, null, "", "Not/AZone", "+09:00", "Asia/Seoul "]) {
    const o = options(t); o.snapshot.timeZone = timeZone;
    assert.throws(() => assign(t, o), /IANA/);
  }
  const o = options(t); o.snapshot.timeZone = "America/Los_Angeles";
  o.now = new Date("2026-10-04T00:00:00Z");
  assert.doesNotThrow(() => assign(t, o)); // UTC 다음 날이어도 사용자에게는 같은 날
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
  assert.throws(() => assign(t, options(t, { snapshot: undefined })), /snapshot 누락/);
  const wrongClient = options(t); wrongClient.snapshot.client = "codex-cli";
  assert.throws(() => assign(t, wrongClient), /클라이언트/);
  const o = options(t); o.snapshot.context = "different-account";
  assert.throws(() => assign(t, o), /계정/);
  o.snapshot.context = t.clients["codex-desktop"].context; o.snapshot.version = "different-version";
  assert.throws(() => assign(t, o), /클라이언트/);
  const m = t.clients["codex-desktop"].models.balanced;
  m.capability = "pending";
  assert.throws(() => assign(t, options(t, { evaluate: false })), /실행 검증/);
  m.capability = "confirmed";
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
  const o = { client: "claude-cli", tier: "balanced", effort: "medium", role: "review", reason: "일반 리뷰", now, evaluate: true, env: {}, snapshot: { client: "claude-cli", version: c.version, context: c.context, timeZone: "Asia/Seoul", observedAt: now.toISOString(), models: [{ model: m.model, actualModel: m.resolvedModel, efforts: m.efforts }] } };
  assert.equal(assign(t, o).invocation.effort, "medium");
  assert.throws(() => assign(t, { ...o, env: { CLAUDE_CODE_SUBAGENT_MODEL: "opus" } }), /충돌/);
  o.snapshot.models[0].actualModel = "claude-opus-4-6";
  assert.throws(() => assign(t, o), /실제 모델 불일치/);
  o.snapshot.models[0].actualModel = "claude-sonnet-new-version";
  assert.throws(() => assign(t, o), /실제 모델 불일치/);
  m.nativeExecution = "yes";
  assert.throws(() => validate(t), /검증 상태/);
});

test("sync는 프로젝트 main 모델과 agents defaults만 맞추고 다른 키는 보존한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-config-"));
  try {
    mkdirSync(path.join(root, ".codex"));
    writeFileSync(path.join(root, ".codex/config.toml"), 'model = "user-main"\nmodel_reasoning_effort = "high"\n[agents]\nmax_threads = 4\ndefault_subagent_model = "old"\n[mcp_servers.example]\nurl = "https://example.com"\n');
    sync(root, table());
    const text = readFileSync(path.join(root, ".codex/config.toml"), "utf8");
    assert.equal(parse(text).model, table().modelPolicy.allowedModels.codex);
    assert.match(text, /model_reasoning_effort = "high"/);
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

test("Claude 프로젝트 main 모델만 갱신하고 비소유 설정·동일 원문은 보존한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "claude-main-"));
  try {
    sync(root, table());
    const config = path.join(root, ".claude/settings.json");
    const original = { model: "old", permissions: { allow: ["Read"] }, env: { EXAMPLE: "unchanged" }, hooks: {} };
    writeFileSync(config, JSON.stringify(original));
    assert.match(check(root, table()).join(), /settings.json/);
    sync(root, table());
    const expected = { ...original, model: table().modelPolicy.allowedModels.claude };
    assert.deepEqual(JSON.parse(readFileSync(config, "utf8")), expected);
    const customFormatting = JSON.stringify(expected);
    writeFileSync(config, customFormatting);
    sync(root, table());
    assert.equal(readFileSync(config, "utf8"), customFormatting);
    assert.deepEqual(check(root, table()), []);
    for (const invalid of ["{", "null", "[]", '"scalar"']) {
      writeFileSync(config, invalid);
      const owned = path.join(root, ".codex/agents/task-balanced.toml");
      writeFileSync(owned, "user pending file\n");
      assert.throws(() => check(root, table()), /JSON 객체/);
      assert.throws(() => sync(root, table()), /JSON 객체/);
      assert.equal(readFileSync(config, "utf8"), invalid);
      assert.equal(readFileSync(owned, "utf8"), "user pending file\n");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("여러 줄 TOML basic/literal 본문과 실제 agents를 parser로 구분하고 본문을 보존한다", () => {
  for (const delimiter of ['"""', "'''"]) {
    for (const realAgents of [false, true]) {
      const root = mkdtempSync(path.join(tmpdir(), "agent-multiline-"));
      try {
        sync(root, table());
        const config = path.join(root, ".codex/config.toml");
        const text = `developer_instructions = ${delimiter}\n[agents]\ndefault_subagent_model = "instruction-model"\n${delimiter}\n${realAgents ? '[agents]\ndefault_subagent_model = "old"\n' : ""}`;
        writeFileSync(config, text);
        const before = parse(text);
        sync(root, table());
        const result = readFileSync(config, "utf8");
        const after = parse(result);
        assert.equal(after.developer_instructions, before.developer_instructions);
        assert.ok(result.startsWith(text.split(delimiter)[0] + delimiter + text.split(delimiter)[1] + delimiter));
        assert.equal(after.agents.default_subagent_model, table().clients["codex-cli"].models.balanced.model);
        assert.deepEqual(check(root, table()), []);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  }
});

test("TOML 주석과 다른 단일행 문자열의 delimiter는 거부하거나 변경하지 않는다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-toml-context-"));
  try {
    sync(root, table());
    const prefix = [
      '# comment: """ and \'\'\' [agents]',
      `developer_instructions = 'basic delimiter """ [agents]'`,
      'other_instructions = "literal delimiter \'\'\' [agents]"',
      'escaped_instructions = "escaped \\" quotes and \\\\\\" [agents]"',
      '',
    ].join("\n");
    const config = path.join(root, ".codex/config.toml");
    writeFileSync(config, prefix);
    sync(root, table());
    const result = readFileSync(config, "utf8");
    assert.ok(result.startsWith(prefix));
    assert.equal(parse(result).agents.default_subagent_model, table().clients["codex-cli"].models.balanced.model);
    assert.deepEqual(check(root, table()), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("공백/basic/literal 표와 quoted 키의 같은 의미를 읽고 두 값 외 원문을 보존한다", () => {
  for (const header of ["[ agents ]", '["agents"]', "['agents']", String.raw`["\u0061gents"]`]) {
    for (const key of ["default_subagent_model", '"default_subagent_model"', "'default_subagent_model'"]) {
      const root = mkdtempSync(path.join(tmpdir(), "agent-toml-syntax-"));
      try {
        sync(root, table());
        const config = path.join(root, ".codex/config.toml");
        const original = `# user header\nmodel = 'main'\n${header} # user table comment\n${key}   = 'old' # model comment\n'default_subagent_reasoning_effort' = 'low' # effort comment\nmax_threads = 3\n\n[mcp_servers.example]\nurl = 'https://example.com' # user provider\n`;
        assert.equal(parse(original).agents.default_subagent_model, "old");
        writeFileSync(config, original);
        assert.match(check(root, table()).join(), /설정 불일치/);
        sync(root, table());
        const expected = original.replace("'main'", `'${table().modelPolicy.allowedModels.codex}'`).replace("'old'", `'${table().clients["codex-cli"].models.balanced.model}'`).replace("'low'", "'medium'");
        const result = readFileSync(config, "utf8");
        // 소유한 agents 표 header의 동등한 표기/공백 정규화만 허용한다.
        assert.deepEqual(result.split("\n").filter((_, i) => i !== 2), expected.split("\n").filter((_, i) => i !== 2));
        assert.ok(result.split("\n")[2].includes("# user table comment"));
        assert.equal(parse(result).agents.default_subagent_model, table().clients["codex-cli"].models.balanced.model);
        assert.deepEqual(check(root, table()), []);
        sync(root, table());
        assert.equal(readFileSync(config, "utf8"), result);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  }
});

test("dotted/inline/nested 표도 parser 의미로 갱신하고 다른 설정을 보존한다", () => {
  for (const text of [
    'agents.default_subagent_model = "old"\nagents.max_threads = 4\n',
    'agents = { default_subagent_model = "old", max_threads = 4 } # inline comment\n',
    '[agents.child]\nmodel = "user-child"\n',
    '# arrays and dates\nlimits = [\n  1, # first\n  2,\n]\ncreated = 2026-10-03\nbig = 9223372036854775807\n',
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), "agent-toml-structure-"));
    try {
      sync(root, table());
      const config = path.join(root, ".codex/config.toml");
      writeFileSync(config, text);
      const before = parse(text, { integersAsBigInt: "asNeeded" });
      sync(root, table());
      const result = readFileSync(config, "utf8");
      const after = parse(result, { integersAsBigInt: "asNeeded" });
      assert.equal(after.agents.default_subagent_model, table().clients["codex-cli"].models.balanced.model);
      for (const [key, value] of Object.entries(before)) {
        if (key !== "agents") assert.deepEqual(after[key], value);
      }
      if (before.agents?.max_threads) assert.equal(after.agents.max_threads, before.agents.max_threads);
      if (before.agents?.child) assert.deepEqual(after.agents.child, before.agents.child);
      for (const line of text.split("\n").filter((line) => line.includes("#"))) assert.ok(result.includes(line.includes("inline") ? "# inline comment" : line));
      assert.deepEqual(check(root, table()), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("중복 표/키·잘못된 구조·문법은 check와 sync에서 거부하고 모든 파일을 보존한다", () => {
  for (const text of [
    '[agents]\n["agents"]\n',
    '[agents]\ndefault_subagent_model = "one"\n"default_subagent_model" = "two"\n',
    '[agents]\ndefault_subagent_model = "unterminated\n',
    'agents = "user scalar"\n',
    '[[agents]]\nmodel = "array entry"\n',
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), "agent-toml-reject-"));
    try {
      sync(root, table());
      const config = path.join(root, ".codex/config.toml");
      writeFileSync(config, text);
      const files = Object.keys(generated(table()));
      const owned = path.join(root, ".codex/agents/task-balanced.toml");
      writeFileSync(owned, "user pending file\n");
      const before = files.map((file) => readFileSync(path.join(root, file)));
      assert.throws(() => check(root, table()), /TOML 문법|agents는 설정 표/);
      assert.throws(() => sync(root, table()), /TOML 문법|agents는 설정 표/);
      for (let i = 0; i < files.length; i++) assert.deepEqual(readFileSync(path.join(root, files[i])), before[i]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
