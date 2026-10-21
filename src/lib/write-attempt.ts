import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, isUncertain } from "./api-error.ts";

type MetadataStorage = Pick<Storage, "setItem" | "removeItem">;
const attempts = new Map<string, WriteAttempt>();
const prefix = "workspace:unresolved-write:";
function browserStorage(): MetadataStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
export class WriteOriginChangedError extends Error {
  constructor(message: string, readonly responseUnknown = false) {
    super(message);
    this.name = "AbortError";
  }
}
export type FrozenWrite = {
  actorId: string;
  workspaceId: string | null;
  method: string;
  path: string;
  body: string | undefined;
};
export function freezeWrite(key: string, request: FrozenWrite): FrozenWrite {
  const attempt = attempts.get(key);
  if (!attempt) throw new Error("쓰기 시도에 속하지 않은 요청 키입니다");
  return attempt.freeze(request);
}
export function retainedWrite(key: string): FrozenWrite | null {
  return attempts.get(key)?.frozenRequest() ?? null;
}
/** One logical attempt retains the exact operation until its outcome is definite. */
export class WriteAttempt<Result = unknown> {
  private state = { busy: false, uncertain: false };
  private retained: (() => Promise<Result>) | null = null;
  private key: string | null = null;
  private frozen: FrozenWrite | null = null;
  frozenRequest() {
    return this.frozen;
  }
  freeze(request: FrozenWrite) {
    this.frozen ??= Object.freeze({ ...request });
    const parts = this.frozen.path.split("?")[0].split("/").filter(Boolean);
    const model = parts[0] === "settings"
      ? "settings"
      : parts[0].replace(/s$/, "");
    const action = this.frozen.method === "DELETE"
      ? "delete"
      : parts[2] === "occurrences"
      ? "record"
      : parts[2] ?? (this.frozen.method === "PATCH"
        ? model === "tag" ? "rename" : "update"
        : "create");
    this.track(
      `${parts[2] === "occurrences" ? "occurrence" : model}.${action}`,
      parts.slice(1).join("/"),
    );
    return this.frozen;
  }
  private metadata: { operation: string; target: string } | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private storage: MetadataStorage | undefined = browserStorage(),
  ) {}
  requestKey = () => {
    if (!this.key) throw new Error("쓰기 시도를 시작해야 합니다");
    return this.key;
  };
  track(operation: string, target: string) {
    this.metadata = { operation, target };
    this.persist("pending");
  }
  private persist(status: string) {
    if (!this.key || !this.metadata) return;
    try {
      this.storage?.setItem(
        prefix + this.key,
        JSON.stringify({
          request_key: this.key,
          ...this.metadata,
          ...(this.frozen
            ? {
              actorId: this.frozen.actorId,
              workspaceId: this.frozen.workspaceId,
              method: this.frozen.method,
              path: this.frozen.path,
            }
            : {}),
          status,
        }),
      );
    } catch { /* Storage is optional. */ }
  }
  private finish() {
    if (this.key) {
      try {
        this.storage?.removeItem(prefix + this.key);
      } catch { /* Storage is optional. */ }
      attempts.delete(this.key);
    }
    this.key = null;
    this.metadata = null;
    this.frozen = null;
    this.retained = null;
  }
  /** Cancel cannot turn an unresolved write into a fresh automatic submission. */
  reset() {
    if (this.state.busy || this.state.uncertain) return;
    this.finish();
    this.publish(false, false);
  }
  abandon() {
    if (this.key) attempts.delete(this.key);
    this.retained = null;
    this.frozen = null;
  }
  /** Called only for an explicit new intention; unresolved metadata remains for current-state review. */
  startNewIntent() {
    if (this.state.busy) return;
    if (!this.state.uncertain) {
      this.reset();
      return;
    }
    this.abandon();
    this.key = null;
    this.metadata = null;
    this.publish(false, false);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(busy: boolean, uncertain: boolean) {
    this.state = { busy, uncertain };
    for (const listener of this.listeners) listener();
  }
  async run(operation: () => Promise<Result>): Promise<Result | undefined> {
    if (this.state.busy) return;
    const execute = this.retained ?? operation;
    this.key ??= crypto.randomUUID();
    attempts.set(this.key, this);
    this.publish(true, this.state.uncertain);
    try {
      const result = await execute();
      this.finish();
      this.publish(false, false);
      return result;
    } catch (error) {
      const uncertain = isUncertain(error) ||
        error instanceof WriteOriginChangedError &&
          (error.responseUnknown || this.state.uncertain);
      if (uncertain) {
        this.retained = execute;
        this.persist("unknown");
      } else this.finish();
      this.publish(false, uncertain);
      throw error;
    }
  }
}
export function useWriteAttempt<Result = unknown>() {
  const [attempt] = useState(() => new WriteAttempt<Result>());
  useEffect(() => () => attempt.abandon(), [attempt]);
  return {
    attempt,
    ...useSyncExternalStore(
      attempt.subscribe,
      attempt.snapshot,
      attempt.snapshot,
    ),
  };
}
export function writeErrorMessage(error: unknown): string {
  if (isUncertain(error)) {
    return "저장 여부를 알 수 없습니다. 같은 요청 키와 내용으로 다시 시도하세요. 화면을 닫거나 새로고침하면 현재 상태를 조회해 확인한 뒤 새 작업을 시작하세요.";
  }
  if (error instanceof ApiError) {
    if (error.code === "result_expired") {
      return "요청 키와 성공 결과의 30일 보관 기간이 지났습니다. 이후에는 중복 방지가 보장되지 않습니다. 현재 상태를 확인하세요. 새 키로 자동 재전송하지 마세요.";
    }
    if (error.code === "idempotency_key_reused") {
      return `${error.message} 현재 상태를 확인하세요. 새 키로 자동 재전송하지 마세요.`;
    }
    return error.code === "conflict"
      ? `${error.message} 화면을 닫고 다시 연 뒤 시도하세요.`
      : error.message;
  }
  return "처리하지 못했습니다.";
}

/** Payload closures are unavailable after reload; metadata is guidance, never a resend source. */
export function hasUnresolvedWrites(
  scope?: { actorId: string; workspaceId: string | null },
) {
  try {
    const storage = globalThis.sessionStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      // A live attempt owns its pending result and retry UI; this notice is for lost owners.
      if (attempts.has(key.slice(prefix.length))) continue;
      if (!scope) return true;
      try {
        const value = JSON.parse(storage.getItem(key) ?? "null");
        if (
          value?.actorId === scope.actorId &&
          value?.workspaceId === scope.workspaceId
        ) return true;
      } catch { /* Ignore invalid advisory metadata. */ }
    }
  } catch { /* Browser restart or unavailable storage cannot recover keys. */ }
  return false;
}
