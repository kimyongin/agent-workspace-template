#!/usr/bin/env node
// 저장소 텍스트 파일과 문서의 기본 규칙을 검사한다.
// 사용: node scripts/check-docs.mjs [저장소 루트]
// 검사: UTF-8 BOM 없음, LF 줄바꿈, 줄 끝 공백, 마지막 줄바꿈, 마크다운·HTML 내부 상대 링크,
//       공유 스킬 정본과 Claude 연결 파일의 metadata·호출 정책·연결 일치.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_CANONICAL_ROOT = ".agents/skills";
const SKILL_CLAUDE_ROOT = ".claude/skills";

export function listFiles(root) {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(path.join(root, f)));
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

export function checkText(file, buf) {
  const problems = [];
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.push(`${file}: UTF-8 BOM이 있다`);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    problems.push(`${file}: UTF-8이 아닌 바이트가 있다`);
  }
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.endsWith("\r")) {
      problems.push(`${file}:${i + 1}: CRLF 줄바꿈`);
    } else if (/[ \t]$/.test(line)) {
      problems.push(`${file}:${i + 1}: 줄 끝 공백`);
    }
  });
  if (text.length > 0 && !text.endsWith("\n")) {
    problems.push(`${file}: 마지막 줄바꿈이 없다`);
  }
  return problems;
}

// 코드 블록과 인라인 코드를 제외한 마크다운 인라인 링크의 대상을 줄 번호와 함께 돌려준다.
export function markdownLinks(text) {
  const links = [];
  let fence = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const stripped = line.replace(/`[^`]*`/g, "");
    for (const m of stripped.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ line: i + 1, target: m[1] });
    }
  });
  return links;
}

// script·style·주석을 제외한 HTML의 href·src 대상을 줄 번호와 함께 돌려준다.
export function htmlLinks(text) {
  const blanked = text.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    (m) => m.replace(/[^\n]/g, " "),
  );
  const links = [];
  for (const m of blanked.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const target = (m[1] ?? m[2]).trim();
    if (!target) continue;
    const line = blanked.slice(0, m.index).split("\n").length;
    links.push({ line, target });
  }
  return links;
}

export function checkLinks(root, file, text, links = markdownLinks(text)) {
  const problems = [];
  for (const { line, target } of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const rel = decodeURIComponent(target.split("#")[0]);
    if (rel.startsWith("/")) {
      problems.push(`${file}:${line}: 절대 경로 링크 ${target}`);
      continue;
    }
    const resolved = path.resolve(root, path.dirname(file), rel);
    const inside = path.relative(root, resolved);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      problems.push(`${file}:${line}: 저장소 밖을 가리키는 링크 ${target}`);
    } else if (!existsSync(resolved)) {
      problems.push(`${file}:${line}: 깨진 링크 ${target}`);
    }
  }
  return problems;
}

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

export function checkSkillLink(root) {
  const directories = (relative) => existsSync(path.join(root, relative))
    ? readdirSync(path.join(root, relative), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  const names = new Set([...directories(SKILL_CANONICAL_ROOT), ...directories(SKILL_CLAUDE_ROOT)]);
  const problems = [];
  for (const name of names) {
    const canonical = `${SKILL_CANONICAL_ROOT}/${name}/SKILL.md`;
    const link = `${SKILL_CLAUDE_ROOT}/${name}/SKILL.md`;
    if (!existsSync(path.join(root, canonical)) || !existsSync(path.join(root, link))) {
      problems.push(`${link}: 정본 스킬과 Claude 연결 파일 중 하나가 없다`);
      continue;
    }
    const a = frontmatter(readFileSync(path.join(root, canonical), "utf8"));
    const linkedText = readFileSync(path.join(root, link), "utf8");
    const b = frontmatter(linkedText);
    if (!a || !b) {
      problems.push(`${link}: frontmatter를 읽을 수 없다`);
      continue;
    }
    for (const key of ["name", "description", "disable-model-invocation"]) {
      if (a[key] !== b[key]) problems.push(`${link}: ${key} 값이 정본(${canonical})과 다르다`);
    }
    const target = `../../../${canonical}`;
    if (!markdownLinks(linkedText).some((entry) => entry.target === target)) {
      problems.push(`${link}: 정본(${canonical}) 연결이 없다`);
    }
  }
  return problems;
}

export function checkRepo(root) {
  const problems = [];
  let count = 0;
  const files = listFiles(root);
  for (const file of files) {
    const full = path.join(root, file);
    if (!statSync(full).isFile()) continue;
    const buf = readFileSync(full);
    if (isBinary(buf)) continue;
    count += 1;
    problems.push(...checkText(file, buf));
    if (file.endsWith(".md")) {
      problems.push(...checkLinks(root, file, buf.toString("utf8")));
    } else if (file.endsWith(".html")) {
      const text = buf.toString("utf8");
      problems.push(...checkLinks(root, file, text, htmlLinks(text)));
    }
  }
  problems.push(...checkSkillLink(root));
  return { count, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const { count, problems } = checkRepo(root);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\n문서 검사 실패: 텍스트 파일 ${count}개 중 문제 ${problems.length}건`);
    process.exit(1);
  }
  console.log(`문서 검사 통과: 텍스트 파일 ${count}개`);
}
