// 활동과 원칙에서 실제로 함께 쓰는 요청 재시도·목록 커서·검색 입력 해시.
import type { Actor } from "./actor.ts";
import { id, isoDateTime } from "../../contracts/common.ts";
import { conflict, invalidInput } from "./errors.ts";
import type { Keyset, RequestStore } from "./store.ts";

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------- 공통 보조 ----------

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 키 순서와 무관한 JSON(요청 내용 비교용). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

export const searchInputHash = (item: { title: string; summary: string }) =>
  sha256Hex(`${item.title}\n${item.summary}`);

/**
 * `request_id`가 있으면 같은 소유자·작업·키의 첫 결과를 돌려준다. 내용이 다르면 conflict.
 * 같은 키의 동시 요청은 트랜잭션 잠금으로 직렬화해 한 번만 실행한다. 보관 기간은 7일이다.
 */
export async function once<T>(
  store: RequestStore,
  operation: string,
  requestId: string | undefined,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  if (!requestId) return run();
  const hash = await sha256Hex(canonical(payload));
  await store.lockRequest(operation, requestId);
  const prior = await store.findRequest(operation, requestId);
  if (prior) {
    if (prior.request_hash !== hash) throw conflict("같은 request_id로 다른 내용을 보냈습니다");
    return prior.response as T;
  }
  const result = await run();
  await store.saveRequest(operation, requestId, hash, result);
  return result;
}

interface CursorBody {
  at: string;
  id: string;
  /** 커서를 만든 소유자·필터의 해시. 다른 조건에 쓰면 거부한다. */
  scope: string;
}

export async function scopeOf(actor: Actor, filter: unknown): Promise<string> {
  return (await sha256Hex(`${actor.userId}:${canonical(filter)}`)).slice(0, 16);
}

function encodeCursor(body: CursorBody): string {
  return btoa(JSON.stringify(body)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string, scope: string): Keyset {
  try {
    const body = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as CursorBody;
    if (body.scope === scope && isoDateTime.safeParse(body.at).success && id.safeParse(body.id).success) {
      return { at: body.at, id: body.id };
    }
  } catch {
    // 아래에서 invalid_input
  }
  throw invalidInput("cursor가 이 목록 조건의 것이 아닙니다", [{ path: "cursor", message: "유효하지 않은 cursor" }]);
}

export async function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
  sortKey: (row: T) => string,
  scope: string,
): Promise<Page<T>> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next = rows.length > limit && last ? encodeCursor({ at: sortKey(last), id: last.id, scope }) : null;
  return await Promise.resolve({ items, next_cursor: next });
}
