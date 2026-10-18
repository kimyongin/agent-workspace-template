// 업무 HTTP API 클라이언트. 세션 토큰을 붙이고 공통 오류 본문을 ApiError로 바꾼다.
import {
  ENTITY_QUERY_URL_MAX_BYTES,
  entityHttpQuery,
} from "@contracts/entity-query.ts";
import type { ErrorBody } from "@contracts/common.ts";
import {
  freezeWrite,
  retainedWrite,
  WriteOriginChangedError,
} from "./write-attempt.ts";

const base = import.meta.env.VITE_API_URL as string;

import { ApiError } from "./api-error.ts";
export { ApiError, isUncertain } from "./api-error.ts";

export type RequestScope = Readonly<
  { actorId: string; workspaceId: string | null }
>;
export type ApiRequest = <T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestKey?: string,
) => Promise<T>;
export type SessionReader = () => Promise<
  { data: { session: { user: { id: string }; access_token: string } | null } }
>;
const readSession: SessionReader = async () => {
  const { supabase } = await import("./supabase.ts");
  return supabase.auth.getSession();
};
export function createScopedApi(
  scope: RequestScope,
  isCurrent: () => boolean = () => true,
  sessionReader: SessionReader = readSession,
): ApiRequest {
  const origin = Object.freeze({ ...scope });
  return (method, path, body, signal, requestKey) =>
    api(
      origin,
      isCurrent,
      sessionReader,
      method,
      path,
      body,
      signal,
      requestKey,
    );
}
async function api<T>(
  scope: RequestScope,
  isCurrent: () => boolean,
  sessionReader: SessionReader,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  requestKey?: string,
): Promise<T> {
  const assertCurrent = (responseUnknown = false) => {
    if (!isCurrent()) {
      if (responseUnknown) {
        throw new WriteOriginChangedError(
          "공간이 변경되어 저장 결과를 확인하지 못했습니다.",
          true,
        );
      }
      throw new DOMException("공간이 변경되었습니다.", "AbortError");
    }
  };
  assertCurrent();
  if (!scope.actorId) throw new Error("로그인 계정이 필요합니다.");
  const retained = requestKey ? retainedWrite(requestKey) : null;
  let serialized: string | undefined;
  let writing: boolean;
  if (retained) {
    if (
      retained.actorId !== scope.actorId ||
      retained.workspaceId !== scope.workspaceId
    ) {
      throw new WriteOriginChangedError(
        "저장 시도의 계정 또는 공간이 변경되었습니다.",
      );
    }
    ({ method, path, body: serialized } = retained);
    writing = true;
  } else {
    if (
      method === "GET" && path.startsWith("/entities?") &&
      new TextEncoder().encode(`${base}${path}`).byteLength >
        ENTITY_QUERY_URL_MAX_BYTES
    ) {
      body = entityHttpQuery(
        Object.fromEntries(
          new URLSearchParams(path.slice("/entities?".length)),
        ),
      );
      method = "POST";
      path = "/entities/query";
    }
    writing = method !== "GET" &&
      !["/search", "/records/prepare", "/entities/query", "/data-model/preview"]
        .includes(path);
    serialized = body === undefined ? undefined : JSON.stringify(body);
    if (writing) {
      if (!requestKey) throw new Error("업무 쓰기는 요청 키가 필요합니다");
      ({ method, path, body: serialized } = freezeWrite(requestKey, {
        ...scope,
        method,
        path,
        body: serialized,
      }));
    }
  }
  const control = /^\/(?:workspaces|invitations)(?:\/|$)/.test(path);
  if (!control && !scope.workspaceId) {
    throw new Error("업무 요청에는 공간이 필요합니다.");
  }
  const { data } = await sessionReader();
  assertCurrent();
  if (data.session?.user.id !== scope.actorId) {
    throw new WriteOriginChangedError("로그인 계정이 변경되었습니다.");
  }
  signal?.throwIfAborted();
  const headers: Record<string, string> = {};
  if (data.session) {
    headers.authorization = `Bearer ${data.session.access_token}`;
  }
  if (!control) headers["X-Workspace-Id"] = scope.workspaceId!;
  if (requestKey && writing) headers["Idempotency-Key"] = requestKey;
  if (serialized !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: serialized,
      signal,
    });
  } catch (e) {
    if (signal?.aborted && !writing) throw e;
    throw new ApiError(
      0,
      "network",
      "서버에 연결하지 못했습니다. 같은 내용으로 다시 시도할 수 있습니다.",
      [],
      true,
    );
  }
  assertCurrent(writing);
  const notifyReplay = () => {
    if (
      res.ok && res.headers.get("Idempotency-Replayed") === "true" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("workspace:write-replayed", { detail: scope }),
      );
    }
  };
  const notifyTagWrite = () => {
    if (
      writing && /^\/tags(?:\/|\?|$)/.test(path) &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("workspace:tags-changed", { detail: scope }),
      );
    }
  };
  if (res.status === 204) {
    notifyReplay();
    notifyTagWrite();
    return undefined as T;
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError(0, "network", "응답을 읽지 못했습니다.", [], true);
  }
  assertCurrent(writing);
  if (res.ok && writing && !text) {
    throw new ApiError(
      0,
      "network",
      "성공 응답을 확인하지 못했습니다.",
      [],
      true,
    );
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) {
      throw new ApiError(
        0,
        "network",
        "성공 응답을 확인하지 못했습니다.",
        [],
        true,
      );
    }
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
  if (writing && parsed === null) {
    throw new ApiError(
      0,
      "network",
      "성공 응답을 확인하지 못했습니다.",
      [],
      true,
    );
  }
  notifyReplay();
  notifyTagWrite();
  return parsed as T;
}

export function query(
  params: Record<string, string | number | undefined | null>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
