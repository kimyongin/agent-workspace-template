// 업무 오류. 어댑터가 HTTP 상태·MCP 도구 오류로 바꾼다(contracts/common.ts의 ErrorCode).
import type { ErrorBody, ErrorCode } from "../../contracts/common.ts";

export interface FieldError {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldError[],
    readonly current?: ErrorBody["current"],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = () => new AppError("not_found", "항목을 찾을 수 없습니다");
export const conflict = (message: string) => new AppError("conflict", message);
export const invalidInput = (message: string, fields?: FieldError[]) => new AppError("invalid_input", message, fields);
