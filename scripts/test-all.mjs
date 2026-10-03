// 로컬 통합 테스트를 한 번에: 로컬 Supabase 준비 → Edge Functions 실행(이미 떠 있으면 그대로 사용) →
// core·DB·HTTP·MCP·E2E 테스트 → 이 스크립트가 띄운 함수 서버만 정리. 로컬 전용이다.
// 정적 검사(check:docs·check:boundaries·check:deno·test:web·build)는 포함하지 않는다.
// 한계: 이미 떠 있는 함수 서버가 401이 아닌 응답(부팅 중 등)을 주면 새로 띄우며, 정리할 때
// 같은 이름의 Edge Runtime 컨테이너를 멈추므로 다른 터미널의 함수 서버도 함께 끊길 수 있다.
// 사용: npm run test:all  (E2E 브라우저가 없으면 먼저 npx playwright install chromium)
import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isWin = process.platform === "win32";
const API = "http://127.0.0.1:55421/functions/v1/api/tasks";

function run(label, command) {
  console.log(`\n▶ ${label}: ${command}`);
  const started = Date.now();
  const r = spawnSync(command, { stdio: "inherit", shell: true });
  return { label, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
}

/** 함수 서버가 응답하면 인증 없는 요청에 401을 준다. */
async function functionsReady() {
  try {
    return (await fetch(API)).status === 401;
  } catch {
    return false;
  }
}

async function waitReady(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await functionsReady()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const projectId = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];

function stop(child) {
  if (!child) return;
  if (child.exitCode === null) {
    try {
      // Windows는 셸 아래 자식까지 함께 끝낸다.
      if (isWin) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM"); // detached로 만든 프로세스 그룹 전체
    } catch {
      // 이미 끝난 그룹(ESRCH)이어도 아래 컨테이너 정리는 계속한다.
    }
  }
  // CLI를 강제로 끝내면 CLI가 띄운 Edge Runtime 컨테이너가 남으므로 직접 멈춘다.
  if (projectId) spawnSync(`docker stop supabase_edge_runtime_${projectId}`, { shell: true, stdio: "ignore" });
}

const results = [];
const setup = run("로컬 Supabase 준비", "npm run -s setup:local");
results.push(setup);
if (!setup.ok) process.exit(1);

let served = null;
// 중단(Ctrl+C 등)되어도 이 스크립트가 띄운 서버와 컨테이너를 남기지 않는다.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop(served);
    process.exit(130);
  });
}
if (!(await functionsReady())) {
  const log = join(tmpdir(), "workspace-functions.log");
  console.log(`\n▶ Edge Functions 실행(테스트가 끝나면 정리, 로그: ${log})`);
  const out = openSync(log, "w");
  served = spawn("npm run -s serve:functions", { shell: true, stdio: ["ignore", out, out], detached: !isWin });
  if (!(await waitReady(120_000))) {
    stop(served);
    console.error(`Edge Functions가 2분 안에 준비되지 않았습니다. 로그: ${log}`);
    process.exit(1);
  }
}

try {
  for (const [label, script] of [
    ["core", "test:core"],
    ["DB", "test:db"],
    ["HTTP", "test:http"],
    ["MCP", "test:mcp"],
    ["E2E", "test:e2e"],
  ]) results.push(run(label, `npm run -s ${script}`));
} finally {
  stop(served);
}

console.log("\n결과");
for (const r of results) console.log(`  ${r.ok ? "통과" : "실패"}  ${r.label} (${r.seconds}초)`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
