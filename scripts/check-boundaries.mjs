// 의존 경계 검사(ADR-0001, docs/design/template-structure.md).
// - contracts: zod와 같은 폴더의 contracts만 가져온다.
// - core: contracts·core와 순수 검증 라이브러리(zod·ajv/2020·ajv-formats)만. SDK·SQL·HTTP·Deno API·환경변수·adapters·bootstrap 금지.
// - 웹(src): 서버 코드는 @contracts만. 제품 데이터에 supabase-js의 .from/.rpc를 쓰지 않는다(Auth만 허용).
// - 동적 import: 문자열 또는 보간 없는 template literal만 판정한다. 그 외 경로는 경계를 증명할 수 없어 실패한다.
// 사용: node scripts/check-boundaries.mjs [저장소 루트] (실패 시 `파일:줄: 문제`)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
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

function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
    else if (value && typeof value === "object" && typeof value.type === "string") visit(value, callback);
  }
}

function check(file, rules) {
  const source = readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", ...(file.endsWith(".tsx") ? ["jsx"] : [])] });
  } catch (error) {
    problems.push(`${relative(root, file).split(sep).join("/")}:${error.loc?.line ?? 1}: 구문을 분석할 수 없다 (${error.message})`);
    return;
  }
  visit(ast.program, (node) => {
    const where = `${relative(root, file).split(sep).join("/")}:${node.loc.start.line}`;
    const dynamic = node.type === "CallExpression" && node.callee.type === "Import";
    const target = ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
      ? node.source
      : dynamic ? node.arguments[0]
      : node.type === "TSImportType" ? node.argument
      : node.type === "TSExternalModuleReference" ? node.expression : null;
    const spec = target?.type === "StringLiteral" ? target.value
      : target?.type === "TemplateLiteral" && target.expressions.length === 0 ? target.quasis[0].value.cooked : null;
    if (dynamic && spec === null) {
      problems.push(`${where}: 동적 import 경로를 정적으로 확인할 수 없다`);
    } else if (spec !== null) {
      const reason = rules.importAllowed(spec, file);
      if (reason) problems.push(`${where}: ${reason} (${spec})`);
    }
    for (const [forbidden, reason] of rules.forbidden) if (forbidden(node)) problems.push(`${where}: ${reason}`);
  });
}

const insideDir = (spec, file, dir) => spec.startsWith(".") && resolve(file, "..", spec).startsWith(dir + sep);
const isIdentifier = (node, name) => node?.type === "Identifier" && node.name === name;
const memberName = (node) => ["MemberExpression", "OptionalMemberExpression"].includes(node?.type)
  ? node.computed ? node.property.value : node.property.name : null;
const isRuntimeRoot = (node, name) => isIdentifier(node, name) ||
  (isIdentifier(node?.object, "globalThis") && memberName(node) === name);
const isMember = (node, object, properties) =>
  isRuntimeRoot(node.object, object) && properties.includes(memberName(node));
const denoApi = (node) => ["MemberExpression", "OptionalMemberExpression"].includes(node.type) && isRuntimeRoot(node.object, "Deno");

// contracts
for (const file of walk(join(shared, "contracts"))) {
  check(file, {
    importAllowed: (spec) =>
      spec === "zod" || insideDir(spec, file, join(shared, "contracts")) ? null : "contracts는 zod와 contracts만 가져온다",
    forbidden: [[denoApi, "contracts에서 Deno API 사용"]],
  });
}

// core
for (const file of walk(join(shared, "core"))) {
  check(file, {
    importAllowed: (spec) =>
      ["zod", "ajv/2020", "ajv-formats"].includes(spec) || insideDir(spec, file, join(shared, "core")) || insideDir(spec, file, join(shared, "contracts"))
        ? null
        : "core는 contracts·core·순수 검증 라이브러리만 가져온다",
    forbidden: [
      [denoApi, "core에서 Deno API(환경변수 등) 사용"],
      [(node) => ["CallExpression", "OptionalCallExpression"].includes(node.type) &&
        (isIdentifier(node.callee, "fetch") || memberName(node.callee) === "fetch"), "core에서 네트워크 호출"],
      [(node) => isIdentifier(node, "Request") || isIdentifier(node, "Response"), "core에서 HTTP 타입 사용"],
      [(node) => isMember(node, "process", ["env"]), "core에서 환경변수 사용"],
    ],
  });
}

// web
for (const file of walk(join(root, "src"))) {
  check(file, {
    importAllowed: (spec) => {
      if (spec.startsWith("@contracts/")) return null;
      if (insideDir(spec, file, join(root, "supabase"))) {
        return "웹은 서버 코드를 @contracts로만 가져온다";
      }
      return null;
    },
    forbidden: [
      [(node) => isMember(node, "supabase", ["from", "rpc", "schema"]), "웹에서 제품 데이터에 supabase-js .from/.rpc 사용(HTTP API를 쓴다)"],
    ],
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`의존 경계 위반 ${problems.length}건`);
  process.exit(1);
}
console.log("의존 경계 검사 통과");
