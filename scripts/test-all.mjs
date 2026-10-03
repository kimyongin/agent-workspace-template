// 로컬 통합 테스트를 한 번에: 로컬 Supabase 준비 → Edge Functions 실행(이미 떠 있으면 그대로 사용) →
// core·DB·HTTP·MCP·E2E 테스트 → 이 스크립트가 띄운 함수 서버만 정리. 로컬 전용이다.
// 정적 검사(check:docs·check:boundaries·check:deno·test:web·build)는 포함하지 않는다.
// Ctrl+C를 한 번 누르면 남은 단계를 건너뛰고 정리한 뒤 끝난다.
// 한계: 이미 떠 있는 함수 서버가 401이 아닌 응답(부팅 중 등)을 주면 새로 띄우며, 정리할 때
// 같은 이름의 Edge Runtime 컨테이너를 멈추므로 다른 터미널의 함수 서버도 함께 끊길 수 있다.
// 사용: npm run test:all  (E2E 브라우저가 없으면 먼저 npx playwright install chromium)
import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isWin = process.platform === "win32";
const API = "http://127.0.0.1:55421/functions/v1/api/tasks";
// Ctrl+C로 끝난 자식의 종료 상태(Windows STATUS_CONTROL_C_EXIT, 셸의 130).
const INTERRUPT_CODES = new Set([3221225786, -1073741510, 130]);

/** 지금 실행 중인 단계(중단 처리기가 결과에 표시하고 함께 끝낸다). */
let current = null;

/**
 * 한 단계를 실행한다. 이벤트 루프를 막지 않도록 비동기로 기다려야 Ctrl+C 처리기가 바로 실행된다.
 * 동기 실행(spawnSync)이면 처리기가 단계 사이에도 실행되지 못해 단계마다 Ctrl+C를 다시 눌러야 했다.
 */
function run(label, command) {
  console.log(`\n▶ ${label}: ${command}`);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, { stdio: "inherit", shell: true });
    current = { label, started, child };
    const done = (result) => {
      current = null;
      resolve({ label, seconds: Math.round((Date.now() - started) / 1000), ...result });
    };
    // 실행 자체가 실패해도 다음 정리 경로(finally)가 돌도록 실패로 돌려준다.
    child.on("error", () => done({ ok: false, interrupted: false }));
    child.on("close", (code, signal) => {
      done({
        ok: code === 0,
        interrupted: signal === "SIGINT" || signal === "SIGTERM" || INTERRUPT_CODES.has(code),
      });
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (isWin) spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    // 이미 끝났으면 무시
  }
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
let served = null;

function summary() {
  console.log("\n결과");
  for (const r of results) {
    console.log(`  ${r.interrupted ? "중단" : r.ok ? "통과" : "실패"}  ${r.label} (${r.seconds}초)`);
  }
}

// Ctrl+C·종료 신호: 남은 단계를 실행하지 않고, 이 스크립트가 띄운 서버와 컨테이너를 정리하고 끝낸다.
// 같은 콘솔의 자식 단계도 같은 Ctrl+C를 받아 함께 끝난다.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\n중단 요청을 받아 남은 단계를 건너뜁니다.");
    // Ctrl+C는 같은 콘솔의 단계도 받지만, 신호가 이 프로세스에만 온 경우(kill 등)에도 단계를 남기지 않는다.
    if (current) {
      killTree(current.child);
      results.push({
        label: current.label,
        ok: false,
        interrupted: true,
        seconds: Math.round((Date.now() - current.started) / 1000),
      });
    }
    stop(served);
    summary();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

const setup = await run("로컬 Supabase 준비", "npm run -s setup:local");
results.push(setup);
if (!setup.ok) {
  summary();
  process.exit(setup.interrupted ? 130 : 1);
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

let interrupted = false;
try {
  for (const [label, script] of [
    ["core", "test:core"],
    ["DB", "test:db"],
    ["HTTP", "test:http"],
    ["MCP", "test:mcp"],
    ["E2E", "test:e2e"],
  ]) {
    const result = await run(label, `npm run -s ${script}`);
    results.push(result);
    // 신호 처리기보다 자식의 종료가 먼저 보이는 경우에도 남은 단계를 실행하지 않는다.
    if (result.interrupted) {
      interrupted = true;
      console.log("\n중단된 단계가 있어 남은 단계를 건너뜁니다.");
      break;
    }
  }
} finally {
  stop(served);
}

summary();
process.exit(interrupted ? 130 : results.every((r) => r.ok) ? 0 : 1);
