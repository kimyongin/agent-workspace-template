import { useState, useSyncExternalStore } from "react";
import { ApiError, isUncertain } from "./api-error.ts";

/** A single write attempt owns its identity and the operation retained after an uncertain response. */
export class WriteAttempt {
  private state = { busy: false, uncertain: false };
  private retained: (() => Promise<void>) | null = null;
  private id: string | null = null;
  private listeners = new Set<() => void>();
  creationId = () => this.id ??= crypto.randomUUID();
  /** Closing/discarding an attempt ends its retry lifetime. Never discard an in-flight write. */
  reset() {
    if (this.state.busy) return;
    this.retained = null;
    this.id = null;
    this.publish(false, false);
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
  /** Read-only preparation never retains a failed operation as a possibly committed write. */
  async run(operation: () => Promise<void>, write = true): Promise<void> {
    if (this.state.busy) return;
    const execute = this.retained ?? operation;
    this.publish(true, this.state.uncertain);
    try {
      await execute();
      this.retained = null;
      this.id = null;
      this.publish(false, false);
    } catch (error) {
      const uncertain = write && isUncertain(error);
      this.retained = uncertain ? execute : null;
      this.publish(false, uncertain);
      throw error;
    }
  }
}

export function useWriteAttempt() {
  const [attempt] = useState(() => new WriteAttempt());
  return { attempt, ...useSyncExternalStore(attempt.subscribe, attempt.snapshot, attempt.snapshot) };
}

export function writeErrorMessage(error: unknown): string {
  if (isUncertain(error)) return "응답을 받지 못해 저장 여부를 알 수 없습니다. 같은 내용으로 다시 시도할 수 있습니다. 이미 반영됐다면 충돌하거나 대상이 없다고 응답하므로 최신 상태를 확인하세요.";
  if (error instanceof ApiError) return error.code === "conflict" ? `${error.message} 화면을 닫고 다시 연 뒤 시도하세요.` : error.message;
  return "처리하지 못했습니다.";
}
