// 사용: node --test "scripts/*.test.mjs"
// 정상 저장소는 통과하고, 의도적으로 깨뜨린 각 규칙은 검출되는지 확인한다.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkRepo } from "./check-docs.mjs";

const SKILL = "---\nname: develop-agent-app\ndescription: 설명\n---\n\n# 스킬\n";

function makeRepo(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "check-docs-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const files = {
    "README.md": "# 제목\n\n[시작](docs/START.md)과 [외부](https://example.com), [앵커](#제목).\n",
    "docs/START.md": "# 시작\n\n[처음](../README.md#제목)\n\n```text\n[코드 블록 안](missing.md)\n```\n\n`[인라인](missing.md)`\n",
    ".agents/skills/develop-agent-app/SKILL.md": SKILL,
    ".claude/skills/develop-agent-app/SKILL.md": SKILL,
    ...overrides,
  };
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function problemsOf(overrides) {
  const root = makeRepo(overrides);
  try {
    return checkRepo(root).problems;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("정상 저장소는 통과한다", () => {
  assert.deepEqual(problemsOf(), []);
});

test("깨진 상대 링크를 검출한다", () => {
  const problems = problemsOf({ "README.md": "# 제목\n\n[없음](docs/NONE.md)\n" });
  assert.match(problems.join("\n"), /README\.md:3: 깨진 링크 docs\/NONE\.md/);
});

test("CRLF를 검출한다", () => {
  const problems = problemsOf({ "docs/START.md": "# 시작\r\n\r\n본문\r\n" });
  assert.match(problems.join("\n"), /docs\/START\.md:1: CRLF/);
});

test("UTF-8 BOM을 검출한다", () => {
  const problems = problemsOf({ "docs/START.md": "﻿# 시작\n" });
  assert.match(problems.join("\n"), /docs\/START\.md: UTF-8 BOM/);
});

test("UTF-8이 아닌 바이트를 검출한다(정상 U+FFFD 문자가 함께 있어도)", () => {
  const bytes = Buffer.concat([Buffer.from("# 시작 �\n", "utf8"), Buffer.from([0xff, 0x0a])]);
  const problems = problemsOf({ "docs/START.md": bytes });
  assert.match(problems.join("\n"), /docs\/START\.md: UTF-8이 아닌 바이트/);
});

test("줄 끝 공백과 마지막 줄바꿈 누락을 검출한다", () => {
  const problems = problemsOf({ "docs/START.md": "# 시작 \n\n본문" }).join("\n");
  assert.match(problems, /docs\/START\.md:1: 줄 끝 공백/);
  assert.match(problems, /docs\/START\.md: 마지막 줄바꿈이 없다/);
});

test("개발 스킬 정본과 Claude 연결 파일의 frontmatter 불일치를 검출한다", () => {
  const problems = problemsOf({
    ".claude/skills/develop-agent-app/SKILL.md": SKILL.replace("설명", "다른 설명"),
  });
  assert.match(problems.join("\n"), /description 값이 정본/);
});
