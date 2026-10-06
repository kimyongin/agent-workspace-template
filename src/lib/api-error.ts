import type { ErrorBody } from "@contracts/common.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorBody["code"] | "network",
    message: string,
    readonly fields: { path: string; message: string }[] = [],
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** 응답을 받지 못한 경우: 서버에서 실행됐는지 알 수 없다. 같은 데이터 id/버전으로 재시도하며 충돌 시 최신 데이터를 확인한다. */
export const isUncertain = (e: unknown) => e instanceof ApiError && (e.code === "network" || e.status >= 500);
