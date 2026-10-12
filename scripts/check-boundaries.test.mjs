import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("./check-boundaries.mjs", import.meta.url));
const core = "supabase/functions/_shared/core/sample.ts";

function check(files) {
  const root = mkdtempSync(join(tmpdir(), "check-boundaries-"));
  try {
    for (const dir of ["src", "supabase/functions/_shared/core", "supabase/functions/_shared/contracts"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    const result = spawnSync(process.execPath, [cli, root], { encoding: "utf8" });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI rejects a multiline core import with its source line", () => {
  const result = check({ [core]: 'import {\n  value,\n} from "../adapters/store.ts";\n' });
  assert.equal(result.status, 1);
  assert.match(result.output, /core\/sample\.ts:1: core는 contracts·core·순수 검증 라이브러리만 가져온다/);
});

test("CLI checks literal dynamic imports inside functions", () => {
  const result = check({ [core]: 'async function load() { return import("../bootstrap.ts"); }\n' });
  assert.equal(result.status, 1);
  assert.match(result.output, /core\/sample\.ts:1: core는 contracts·core·순수 검증 라이브러리만 가져온다/);
});

test("CLI rejects indeterminate dynamic paths in each checked layer", () => {
  for (const file of [core, "supabase/functions/_shared/contracts/sample.ts", "src/sample.ts"]) {
    for (const source of ['import(path);', 'import(`./${name}.ts`);']) {
      const result = check({ [file]: source });
      assert.equal(result.status, 1);
      assert.match(result.output, /동적 import 경로를 정적으로 확인할 수 없다/);
    }
  }
});

test("CLI checks TypeScript import types and import-equals dependencies", () => {
  for (const source of [
    'type Value = import("../adapters/store.ts").Value;',
    'import store = require("../adapters/store.ts");',
  ]) {
    const result = check({ [core]: source });
    assert.equal(result.status, 1);
    assert.match(result.output, /core는 contracts·core·순수 검증 라이브러리만 가져온다/);
  }
});

test("CLI ignores dependency and runtime examples in comments and strings", () => {
  const result = check({
    [core]: [
      '/* import value from "../adapters/store.ts";',
      'Deno.env.get("KEY"); fetch("url"); Request; process.env.KEY; */',
      'const example = "Deno.env fetch( Request process.env";',
      'const template = `Response Deno.env process.env fetch(`;',
      '// export * from "../bootstrap.ts";',
    ].join("\n"),
    "src/sample.tsx": 'const example = "supabase.from"; const view = <div>supabase.rpc</div>;',
  });
  assert.equal(result.status, 0, result.output);
});

test("CLI reports parse failures and continues checking other files", () => {
  const result = check({
    [core]: "const broken = ;\n",
    "src/sample.ts": 'import "../supabase/functions/_shared/core/value.ts";\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /core\/sample\.ts:1: 구문을 분석할 수 없다/);
  assert.match(result.output, /src\/sample\.ts:1: 웹은 서버 코드를 @contracts로만 가져온다/);
  assert.doesNotMatch(result.output, /at (?:Parser|TypeScriptParser)/);
});

test("CLI normalizes relative paths and keeps neighboring directories outside the server boundary", () => {
  const result = check({
    "src/sample.ts": 'import "../supabase-examples/value.ts";',
    [core]: 'import "./nested/../../contracts/value.ts";',
  });
  assert.equal(result.status, 0, result.output);
});

test("CLI applies each layer's import rule to static and dynamic dependency forms", () => {
  const cases = [
    [core, "../adapters/store.ts", /core는 contracts·core·순수 검증 라이브러리만 가져온다/],
    ["supabase/functions/_shared/contracts/sample.ts", "../core/value.ts", /contracts는 zod와 contracts만 가져온다/],
    ["src/sample.ts", "../supabase/functions/_shared/core/value.ts", /웹은 서버 코드를 @contracts로만 가져온다/],
  ];
  for (const [file, spec, reason] of cases) {
    for (const source of [
      `import type { Value } from "${spec}";`,
      `import { type Value } from "${spec}";`,
      `import "${spec}";`,
      `export {\n Value\n} from "${spec}";`,
      `export type { Value } from "${spec}";`,
      `export * from "${spec}";`,
      `export * as values from "${spec}";`,
      `const load = () => import("${spec}");`,
      `const load = () => import(\`${spec}\`);`,
    ]) {
      const result = check({ [file]: source });
      assert.equal(result.status, 1, source);
      assert.match(result.output, reason);
    }
  }
});

test("CLI accepts allowed dependencies, TSX, Auth usage and excludes test files", () => {
  const result = check({
    [core]: [
      'import { z } from "zod";',
      'import type { Value } from "../contracts/value.ts";',
      'export * from "./nested/../value.ts";',
      'type Item = import("./value.ts").Item;',
      'const load = () => import(`../contracts/value.ts`);',
    ].join("\n"),
    "supabase/functions/_shared/contracts/sample.ts": 'export type { Value } from "./value.ts"; import "zod";',
    "src/sample.tsx": 'import type { Value } from "@contracts/value"; const view = <div />; supabase.auth.getUser();',
    "supabase/functions/_shared/core/ignored.test.ts": 'import "forbidden"; fetch("url");',
    "src/ignored.test.tsx": "const broken = ;",
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /의존 경계 검사 통과/);
});

test("CLI preserves forbidden runtime checks including multiline expressions", () => {
  const cases = [
    [core, 'Deno\n .env.get("KEY");', /core에서 Deno API/],
    [core, 'fetch\n ("url");', /core에서 네트워크 호출/],
    [core, "type Input = Request;", /core에서 HTTP 타입 사용/],
    [core, "new Response();", /core에서 HTTP 타입 사용/],
    [core, "process\n .env.KEY;", /core에서 환경변수 사용/],
    ["supabase/functions/_shared/contracts/sample.ts", 'Deno.env.get("KEY");', /contracts에서 Deno API 사용/],
    ["src/sample.ts", 'supabase\n .from("entities");', /웹에서 제품 데이터/],
    ["src/sample.ts", 'supabase.rpc("save");', /웹에서 제품 데이터/],
    ["src/sample.ts", 'supabase.schema("public");', /웹에서 제품 데이터/],
    [core, 'const example = `text ${fetch("url")}`;', /core에서 네트워크 호출/],
  ];
  for (const [file, source, reason] of cases) {
    const result = check({ [file]: source });
    assert.equal(result.status, 1, source);
    assert.match(result.output, reason);
  }
});

test("CLI rejects normalized paths escaping the allowed directories", () => {
  for (const source of [
    'import "./nested/../../adapters/store.ts";',
    'export * from "../contracts-other/value.ts";',
    'import "../core-other/value.ts";',
  ]) {
    const result = check({ [core]: source });
    assert.equal(result.status, 1);
    assert.match(result.output, /core는 contracts·core·순수 검증 라이브러리만 가져온다/);
  }
});

test("CLI retains detection of fetch calls through the global object", () => {
  const result = check({ [core]: 'globalThis.fetch("url");' });
  assert.equal(result.status, 1);
  assert.match(result.output, /core에서 네트워크 호출/);
});

test("CLI retains Deno, environment and product-data bans through globalThis", () => {
  const cases = [
    [core, 'globalThis.Deno.env.get("KEY");', /core에서 Deno API/],
    [core, 'globalThis?.Deno?.env.get("KEY");', /core에서 Deno API/],
    [core, 'globalThis["Deno"]["env"].get("KEY");', /core에서 Deno API/],
    ["supabase/functions/_shared/contracts/sample.ts", 'globalThis.Deno.env.get("KEY");', /contracts에서 Deno API/],
    [core, "globalThis.process.env.KEY;", /core에서 환경변수 사용/],
    [core, "globalThis?.process?.env?.KEY;", /core에서 환경변수 사용/],
    [core, 'globalThis["process"]["env"].KEY;', /core에서 환경변수 사용/],
    ["src/sample.ts", 'globalThis.supabase.from("entities");', /웹에서 제품 데이터/],
    ["src/sample.ts", 'globalThis?.supabase?.rpc("save");', /웹에서 제품 데이터/],
    ["src/sample.ts", 'globalThis["supabase"]["schema"]("public");', /웹에서 제품 데이터/],
  ];
  for (const [file, source, reason] of cases) {
    const result = check({ [file]: source });
    assert.equal(result.status, 1, source);
    assert.match(result.output, reason);
  }
});
