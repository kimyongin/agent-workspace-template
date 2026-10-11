import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError, isUncertain } from "./api-error.ts";

type MetadataStorage = Pick<Storage, "setItem" | "removeItem">;
const attempts = new Map<string, WriteAttempt>();
const prefix = "workspace:unresolved-write:";
function browserStorage(): MetadataStorage | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}
export type FrozenWrite = {method:string; path:string; body:string | undefined};
export function freezeWrite(key:string, request:FrozenWrite):FrozenWrite {
  const attempt=attempts.get(key);
  if(!attempt) throw new Error("쓰기 시도에 속하지 않은 요청 키입니다");
  return attempt.freeze(request);
}
/** One logical attempt retains the exact operation until its outcome is definite. */
export class WriteAttempt {
  private state = { busy: false, uncertain: false };
  private retained: (() => Promise<void>) | null = null;
  private key: string | null = null;
  private frozen: FrozenWrite | null = null;
  freeze(request:FrozenWrite) {
    this.frozen ??= request;
    const parts=this.frozen.path.split("?")[0].split("/").filter(Boolean);
    const model=parts[0] === "settings" ? "settings" : parts[0].replace(/s$/, "");
    const action=this.frozen.method === "DELETE" ? "delete" : parts[2] ?? (this.frozen.method === "PATCH" ? "update" : "create");
    this.track(`${model}.${action}`,parts.slice(1).join("/"));
    return this.frozen;
  }
  private metadata: {operation: string; target: string} | null = null;
  private listeners = new Set<() => void>();
  constructor(private storage: MetadataStorage | undefined = browserStorage()) {}
  requestKey = () => {
    if (!this.key) throw new Error("쓰기 시도를 시작해야 합니다");
    return this.key;
  };
  track(operation: string, target: string) {
    this.metadata = {operation, target};
    this.persist("pending");
  }
  private persist(status: string) {
    if (!this.key || !this.metadata) return;
    try { this.storage?.setItem(prefix + this.key, JSON.stringify({request_key:this.key, ...this.metadata, status})); } catch { /* Storage is optional. */ }
  }
  private finish() {
    if (this.key) {
      try { this.storage?.removeItem(prefix + this.key); } catch { /* Storage is optional. */ }
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
    if(this.key) attempts.delete(this.key);
    this.retained=null;
    this.frozen=null;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(busy: boolean, uncertain: boolean) {
    this.state = { busy, uncertain };
    for (const listener of this.listeners) listener();
  }
  async run(operation: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
    const execute = this.retained ?? operation;
    this.key ??= crypto.randomUUID();
    attempts.set(this.key, this);
    this.publish(true, this.state.uncertain);
    try {
      await execute();
      this.finish();
      this.publish(false, false);
    } catch (error) {
      const uncertain = isUncertain(error);
      if (uncertain) { this.retained = execute; this.persist("unknown"); }
      else this.finish();
      this.publish(false, uncertain);
      throw error;
    }
  }
}
export function useWriteAttempt() {
  const [attempt] = useState(() => new WriteAttempt());
  useEffect(()=>()=>attempt.abandon(),[attempt]);
  return { attempt, ...useSyncExternalStore(attempt.subscribe, attempt.snapshot, attempt.snapshot) };
}
export function writeErrorMessage(error: unknown): string {
  if (isUncertain(error)) return "저장 여부를 알 수 없습니다. 같은 요청 키와 내용으로 다시 시도하세요. 화면을 닫거나 새로고침하면 현재 상태를 조회해 확인한 뒤 새 작업을 시작하세요.";
  if (error instanceof ApiError) {
    if (error.code === "result_expired" || error.code === "idempotency_key_reused") return `${error.message} 현재 상태를 확인하세요. 새 키로 자동 재전송하지 마세요.`;
    return error.code === "conflict" ? `${error.message} 화면을 닫고 다시 연 뒤 시도하세요.` : error.message;
  }
  return "처리하지 못했습니다.";
}

/** Payload closures are unavailable after reload; metadata is guidance, never a resend source. */
export function hasUnresolvedWrites() {
  try {
    const storage=globalThis.sessionStorage;
    for(let i=0;i<storage.length;i++) if(storage.key(i)?.startsWith(prefix)) return true;
  } catch { /* Browser restart or unavailable storage cannot recover keys. */ }
  return false;
}
