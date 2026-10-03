// 업무 HTTP API 클라이언트. 세션 토큰을 붙이고 공통 오류 본문을 ApiError로 바꾼다.
import type { ErrorBody } from "@contracts/common.ts";
import { supabase } from "./supabase.ts";

const base = import.meta.env.VITE_API_URL as string;

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

/** 응답을 받지 못한 경우: 서버에서 실행됐는지 알 수 없다. 같은 request_id로 다시 보내면 안전하다. */
export const isUncertain = (e: unknown) => e instanceof ApiError && (e.code === "network" || e.status >= 500);

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "서버에 연결하지 못했습니다. 저장 여부를 확인한 뒤 다시 시도하세요", [], true);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // 아래에서 처리
  }
  if (!res.ok) {
    const err = parsed as Partial<ErrorBody> | null;
    throw new ApiError(
      res.status,
      err?.code ?? "internal",
      err?.message ?? "요청을 처리하지 못했습니다",
      err?.fields ?? [],
      err?.retryable ?? res.status >= 500,
    );
  }
  return parsed as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
