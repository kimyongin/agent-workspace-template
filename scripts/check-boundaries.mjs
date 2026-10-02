// 의존 경계 검사(ADR-0001, docs/design/template-structure.md).
// - contracts: zod와 같은 폴더의 contracts만 가져온다.
// - core: contracts·core와 zod만. SDK·SQL·HTTP·Deno API·환경변수·adapters·bootstrap 금지.
// - 웹(src): 서버 코드는 @contracts만. 제품 데이터에 supabase-js의 .from/.rpc를 쓰지 않는다(Auth만 허용).
// 사용: node scripts/check-boundaries.mjs  (실패 시 `파일:줄: 문제`)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const shared = join(root, "supabase", "functions", "_shared");
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const importRe = /^\s*(?:import|export)\s[^"'`]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/;

function check(file, rules) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const where = `${relative(root, file).split(sep).join("/")}:${i + 1}`;
    const m = line.match(importRe);
    if (m) {
      const spec = m[1] ?? m[2];
      const reason = rules.importAllowed(spec, file);
      if (reason) problems.push(`${where}: ${reason} (${spec})`);
    }
    for (const [re, reason] of rules.forbidden) if (re.test(line) && !line.trim().startsWith("//")) problems.push(`${where}: ${reason}`);
  });
}

const insideDir = (spec, file, dir) => spec.startsWith(".") && resolve(file, "..", spec).startsWith(dir + sep);

// contracts
for (const file of walk(join(shared, "contracts"))) {
  check(file, {
    importAllowed: (spec) =>
      spec === "zod" || insideDir(spec, file, join(shared, "contracts")) ? null : "contracts는 zod와 contracts만 가져온다",
    forbidden: [[/\bDeno\./, "contracts에서 Deno API 사용"]],
  });
}

// core
for (const file of walk(join(shared, "core"))) {
  check(file, {
    importAllowed: (spec) =>
      spec === "zod" || insideDir(spec, file, join(shared, "core")) || insideDir(spec, file, join(shared, "contracts"))
        ? null
        : "core는 contracts·core·zod만 가져온다",
    forbidden: [
      [/\bDeno\./, "core에서 Deno API(환경변수 등) 사용"],
      [/\bfetch\(/, "core에서 네트워크 호출"],
      [/\b(Request|Response)\b(?!\w)/, "core에서 HTTP 타입 사용"],
      [/\bprocess\.env\b/, "core에서 환경변수 사용"],
    ],
  });
}

// web
for (const file of walk(join(root, "src"))) {
  check(file, {
    importAllowed: (spec) => {
      if (spec.startsWith("@contracts/")) return null;
      if (spec.startsWith(".") && resolve(file, "..", spec).startsWith(join(root, "supabase"))) {
        return "웹은 서버 코드를 @contracts로만 가져온다";
      }
      return null;
    },
    forbidden: [
      [/\bsupabase\s*\.\s*(from|rpc|schema)\b/, "웹에서 제품 데이터에 supabase-js .from/.rpc 사용(HTTP API를 쓴다)"],
    ],
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`의존 경계 위반 ${problems.length}건`);
  process.exit(1);
}
console.log("의존 경계 검사 통과");
