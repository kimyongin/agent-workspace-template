// Local integration checks; shared runtimes are observed before setup and never cleaned by this run.
import { readLocalConfig } from './local-config.mjs';
import { createLocalRuntimeAdapter, runLeasedLocalChecks } from './local-runtime-cli.mjs';

const controller = new AbortController();
const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
  if (!controller.signal.aborted) {
    console.log('\n중단 요청을 받아 남은 단계를 건너뛰고 직접 만든 실행만 정리합니다.');
    controller.abort(signal);
  }
}]));
for (const [signal, handler] of handlers) process.on(signal, handler);
try {
  const config = readLocalConfig();
  const adapter = createLocalRuntimeAdapter(config);
  const result = await runLeasedLocalChecks(config, {
    checks: ['core', 'DB', 'HTTP', 'MCP', 'E2E'], signal: controller.signal,
  }, adapter);
  console.log(`\n결과 (함수 서버: ${result.runtime === 'borrowed' ? '기존 실행' : '직접 생성'})`);
  for (const item of result.results) console.log(`  ${item.interrupted ? '중단' : item.code === 0 ? '통과' : '실패'}  ${item.label} (${item.seconds ?? 0}초, 종료 ${item.code ?? '실행 실패'})${item.stopFailed ? ' · 자식 정리 실패' : ''}`);
  for (const item of result.errors) console.error(`  실패  ${item.phase} (원래 검사 결과 유지; 함수 실행 로그: ${adapter.log})`);
  process.exitCode = result.exitCode;
} catch {
  console.error('로컬 검사 실행을 준비하지 못했습니다. 기존 실행은 정리하지 않습니다.');
  process.exitCode = controller.signal.aborted ? (controller.signal.reason === 'SIGTERM' ? 143 : 130) : 1;
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
}
