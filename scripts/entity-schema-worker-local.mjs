// Explicit local consumer; setup never starts this loop or creates a schedule.
import { setTimeout as pause } from "node:timers/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readEnv } from "./local-env.mjs";
import { readLocalConfig } from "./local-config.mjs";

export async function runEntitySchemaWorker(
  {
    apiUrl,
    environment,
    once = false,
    checkConfiguration = false,
    intervalMs = 2000,
    timeoutMs = 30000,
    signal,
    report = console.log,
  },
) {
  const url = new URL(apiUrl);
  if (
    url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("스키마 worker는 설정된 로컬 HTTP origin에서만 실행합니다");
  }
  if (environment.VITE_SUPABASE_URL !== url.origin || environment.VITE_API_URL !== `${url.origin}/functions/v1/api`) {
    throw new Error("로컬 설정과 .env.local의 API 주소가 다릅니다. 환경 준비를 확인하세요");
  }
  if (!/^[A-Za-z0-9_-]{43,}$/.test(environment.ENTITY_SCHEMA_WORKER_TOKEN ?? "")) {
    throw new Error("전용 스키마 worker 토큰이 필요합니다. 환경 준비를 확인하세요");
  }
  for (const value of [intervalMs, timeoutMs]) {
    if (!Number.isInteger(value) || value < 100 || value > 60000) {
      throw new Error("대기·시간 제한은 100~60000ms 정수여야 합니다");
    }
  }
  while (!signal?.aborted) {
    try {
      const response = await fetch(`${url.origin}/functions/v1/entity-schema-worker`, {
        method: "POST",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${environment.ENTITY_SCHEMA_WORKER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(checkConfiguration ? { check_configuration: true } : { limit: 1 }),
      });
      report(`스키마 worker HTTP ${response.status}`);
      await response.body?.cancel();
      if (!response.ok) throw new Error(`스키마 worker 호출 실패: HTTP ${response.status}`);
      if (once || checkConfiguration) return;
      await pause(intervalMs, undefined, { signal });
    } catch (error) {
      if (signal?.aborted) return;
      // Raw fetch errors can contain URLs/credentials; output only safe classifications.
      if (error.name === "TimeoutError") throw new Error("스키마 worker 요청 시간 초과. 작업 상태를 다시 확인하세요");
      if (error.message.startsWith("스키마 worker 호출 실패:")) throw error;
      throw new Error("스키마 worker 연결 실패. 작업 상태를 다시 확인하세요");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const stop = new AbortController();
  const interrupt = (signal) => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    stop.abort();
  };
  const onInt = () => interrupt("SIGINT"), onTerm = () => interrupt("SIGTERM");
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      if (arg === "--once") options.once = true;
      else if (arg === "--check-configuration") options.checkConfiguration = true;
      else if (/^--(interval|timeout)-ms=[0-9]+$/.test(arg)) {
        const [name, value] = arg.split("=");
        options[name === "--interval-ms" ? "intervalMs" : "timeoutMs"] = Number(value);
      } else throw new Error("스키마 worker 실행 인자가 올바르지 않습니다");
    }
    await runEntitySchemaWorker({
      ...options,
      apiUrl: readLocalConfig().apiUrl,
      environment: readEnv(new URL("../.env.local", import.meta.url)),
      signal: stop.signal,
    });
  } catch (error) {
    if (!stop.signal.aborted) {
      console.error(
        /^(스키마 worker|전용 스키마 worker|로컬 설정|대기·시간 제한)/.test(error.message)
          ? error.message
          : "로컬 스키마 worker 설정을 확인하세요",
      );
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
}
