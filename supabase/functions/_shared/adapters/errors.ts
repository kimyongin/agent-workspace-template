// 업무 오류·입력 오류를 HTTP와 MCP가 같은 code로 내보내기 위한 변환.
import { z } from "zod";
import { ERROR_HTTP_STATUS, type ErrorBody, RETRYABLE } from "../contracts/common.ts";
import { AppError } from "../core/shared/errors.ts";

export function fromZod(error: z.ZodError): AppError {
  const fields = error.issues.flatMap((i) => {
    const base = i.path.join(".");
    // 허용하지 않은 필드는 필드 이름별로 알린다.
    if (i.code === "unrecognized_keys") {
      return i.keys.map((k) => ({ path: base ? `${base}.${k}` : k, message: "허용하지 않는 필드입니다" }));
    }
    return [{ path: base || "(입력)", message: i.message }];
  });
  return new AppError("invalid_input", "입력이 계약에 맞지 않습니다", fields);
}

/** 계약 schema로 검사한다. 실패하면 invalid_input(위반 필드 목록 포함). */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw fromZod(r.error);
  return r.data;
}

export function toErrorBody(e: unknown): { status: number; body: ErrorBody } {
  const err = e instanceof AppError ? e : e instanceof z.ZodError ? fromZod(e) : null;
  if (!err) {
    console.error("unexpected error", e);
    return { status: 500, body: { code: "internal", message: "서버 오류가 발생했습니다", retryable: true } };
  }
  const body: ErrorBody = { code: err.code, message: err.message, retryable: RETRYABLE[err.code] };
  if (err.code === "request_in_progress") body.retry_after_seconds = 1;
  if (err.fields?.length) body.fields = err.fields;
  return { status: ERROR_HTTP_STATUS[err.code], body };
}
