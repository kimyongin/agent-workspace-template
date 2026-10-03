// 모든 기능이 공유하는 입력 규칙·오류·페이지 계약.
// 정본: docs/tickets/template-02-t02-1-contracts.md "공통 규칙". zod만 가져온다(웹도 이 파일을 쓴다).
import { z } from "zod";

/** 길이는 Unicode 코드 포인트로 센다. 앞뒤 공백을 제거한 뒤 검사한다. */
export function codePointLength(value: string): number {
  return [...value].length;
}

export function text(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((v) => codePointLength(v) >= min, { message: min === 1 ? "필수 입력입니다" : `${min}자 이상이어야 합니다` })
    .refine((v) => codePointLength(v) <= max, { message: `${max}자 이하여야 합니다` });
}

export const TEXT_LIMITS = {
  title: { min: 1, max: 100 },
  summary: { min: 1, max: 300 },
  body: { min: 0, max: 20_000 },
} as const;

export const title = text(TEXT_LIMITS.title.min, TEXT_LIMITS.title.max);
export const summary = text(TEXT_LIMITS.summary.min, TEXT_LIMITS.summary.max);
export const body = text(TEXT_LIMITS.body.min, TEXT_LIMITS.body.max);
export const contentLabels = { title: "제목", summary: "요약", body: "본문" } as const;

export const id = z.uuid();

/** `YYYY-MM-DD`이며 실제로 있는 날짜. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "YYYY-MM-DD 형식이어야 합니다" })
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, { message: "없는 날짜입니다" });

/** ISO 8601 시각. 응답은 UTC(`Z`)로 준다. */
export const isoDateTime = z.iso.datetime({ offset: true });

export const expectedVersion = z.number().int().min(1);
export const requestId = z.uuid();

export const pageInput = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(500).optional(),
};

export const ERROR_CODES = [
  "invalid_input",
  "invalid_reference",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  invalid_reference: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export const RETRYABLE: Record<ErrorCode, boolean> = {
  invalid_input: false,
  invalid_reference: false,
  unauthenticated: false,
  forbidden: false,
  not_found: false,
  conflict: false,
  rate_limited: true,
  unavailable: true,
  internal: true,
};

export const errorBody = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  fields: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorBody = z.infer<typeof errorBody>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() });
}
