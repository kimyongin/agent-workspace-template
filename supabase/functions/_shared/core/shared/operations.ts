// 자료·할 일·기록에서 함께 쓰는 목록 커서·검색 입력 해시.
import type { Actor } from "./actor.ts";
import { id, isoDateTime } from "../../contracts/common.ts";
import { invalidInput } from "./errors.ts";
import type { Keyset } from "./store.ts";

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

// ---------- 공통 보조 ----------

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export const searchInputHash = (body: string) => sha256Hex(body);

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
