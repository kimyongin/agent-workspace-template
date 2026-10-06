// 업무 HTTP API 클라이언트. 세션 토큰을 붙이고 공통 오류 본문을 ApiError로 바꾼다.
import type { ErrorBody } from "@contracts/common.ts";
import { supabase } from "./supabase.ts";

const base = import.meta.env.VITE_API_URL as string;

import { ApiError } from "./api-error.ts";
export { ApiError, isUncertain } from "./api-error.ts";

export async function api<T>(method: string, path: string, body?: unknown, signal?:AbortSignal): Promise<T> {
  const { data } = await supabase.auth.getSession();
  signal?.throwIfAborted();
  const headers: Record<string, string> = {};
  if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if(signal?.aborted)throw e;
    throw new ApiError(0, "network", "서버에 연결하지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다.", [], true);
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
