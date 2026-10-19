import type { Actor } from "./actor.ts";
import { invalidInput } from "./errors.ts";
import { requestKey } from "../../contracts/request.ts";

export interface RequestIdentity {
  key: string;
  operation: string;
  fingerprint: string;
}
export interface RequestStore {
  replayRetainedRequest?<T>(request: RequestIdentity): Promise<{ found: boolean; result?: T }>;
  executeRequest?<T>(request: RequestIdentity, execute: () => Promise<T>): Promise<T>;
}
export function requireRequestKey(actor: Actor): string {
  const parsed = requestKey.safeParse(actor.request?.key);
  if (!parsed.success) throw invalidInput("쓰기 요청에 유효한 요청 키가 필요합니다");
  return parsed.data;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
        [k, v],
      ) => [k, canonical(v)]),
    );
  }
  return value;
}
/** Called explicitly inside a write transaction; reads/preparation never enter this boundary. */
export async function runRequest<T>(
  store: RequestStore,
  actor: Actor,
  operation: string,
  target: unknown,
  input: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  const { key, fingerprint } = await requestIdentity(actor, operation, target, input);
  if (!store.executeRequest) throw invalidInput("요청 원장 저장소가 필요합니다");
  return await store.executeRequest({ key, operation, fingerprint }, execute);
}

export function runWrite<S extends RequestStore, T>(
  uow: { run<R>(actor: Actor, fn: (store: S) => Promise<R>): Promise<R> },
  actor: Actor,
  operation: string,
  target: unknown,
  input: unknown,
  execute: (store: S) => Promise<T>,
): Promise<T> {
  requireRequestKey(actor);
  return uow.run(actor, (store) => runRequest(store, actor, operation, target, input, () => execute(store)));
}

export async function requestIdentity(
  actor: Actor,
  operation: string,
  target: unknown,
  input: unknown,
): Promise<RequestIdentity> {
  const key = requireRequestKey(actor);
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonical(
      actor.workspaceId
        ? { revision: 2, executor_id: actor.userId, workspace_id: actor.workspaceId, operation, target, input }
        : { revision: 1, operation, target, input },
    )),
  );
  const fingerprint = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return { key, operation, fingerprint };
}
