// 업무 HTTP API 클라이언트. 세션 토큰을 붙이고 공통 오류 본문을 ApiError로 바꾼다.
import type { ErrorBody } from "@contracts/common.ts";
import { freezeWrite } from "./write-attempt.ts";
import { supabase } from "./supabase.ts";

const base = import.meta.env.VITE_API_URL as string;

import { ApiError } from "./api-error.ts";
export { ApiError, isUncertain } from "./api-error.ts";

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestKey?: string,
): Promise<T> {
  const writing = method !== "GET" && !["/search", "/records/prepare"].includes(path);
  let serialized = body === undefined ? undefined : JSON.stringify(body);
  if (writing) {
    if (!requestKey) throw new Error("업무 쓰기는 요청 키가 필요합니다");
    ({ method, path, body: serialized } = freezeWrite(requestKey, { method, path, body: serialized }));
  }
  const { data } = await supabase.auth.getSession();
  signal?.throwIfAborted();
  const headers: Record<string, string> = {};
  if (data.session) headers.authorization = `Bearer ${data.session.access_token}`;
  if (requestKey) headers["Idempotency-Key"] = requestKey;
  if (serialized !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: serialized, signal });
  } catch (e) {
    if (signal?.aborted && !writing) throw e;
    throw new ApiError(0, "network", "서버에 연결하지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다.", [], true);
  }
  if (res.ok && res.headers.get("Idempotency-Replayed") === "true" && typeof window !== "undefined") {
    window.dispatchEvent(new Event("workspace:write-replayed"));
  }
  if (res.status === 204) return undefined as T;
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError(0, "network", "응답을 읽지 못했습니다.", [], true);
  }
  if (res.ok && writing && !text) throw new ApiError(0, "network", "성공 응답을 확인하지 못했습니다.", [], true);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ApiError(0, "network", "성공 응답을 확인하지 못했습니다.", [], true);
  }
  if (!res.ok) {
    const err = parsed as Partial<ErrorBody> | null;
    throw new ApiError(
      res.status,
      err?.code ?? "internal",
      err?.message ?? "요청을 처리하지 못했습니다",
      err?.fields ?? [],
      err?.retryable ?? res.status >= 500,
      err?.current,
    );
  }
  if (writing && parsed === null) throw new ApiError(0, "network", "성공 응답을 확인하지 못했습니다.", [], true);
  return parsed as T;
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
