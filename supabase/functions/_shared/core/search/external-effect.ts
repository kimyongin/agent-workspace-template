import type { Actor } from "../shared/actor.ts";

/** A passage identity contains references/hashes only; its text is never durable. */
export interface PassageEffectInput {
  message_id: string;
  pipeline: string;
  provider_scope: string;
  model: string;
  dimensions: number;
  start: number;
  end: number;
  input_hash: string;
}
export interface ProviderCapabilities {
  idempotency: { valid_for_seconds: number } | null;
  lookup: boolean;
}
export type EffectReason =
  | "provider_unknown"
  | "transient"
  | "configuration"
  | "input_limit"
  | "invalid_response"
  | "retry_exhausted"
  | "key_expired"
  | "unsupported_recovery";
export type ProviderOutcome =
  | { state: "succeeded"; vector: number[]; job_id?: string }
  | { state: "accepted"; job_id: string }
  | { state: "failed"; reason: "transient" | "configuration" | "input_limit" }
  | { state: "unknown"; reason: "provider_unknown" | "invalid_response" };
export interface PassageProvider {
  capabilities: ProviderCapabilities;
  send(text: string, key: string): Promise<ProviderOutcome>;
  lookup?(jobId: string, key: string): Promise<ProviderOutcome>;
}
export type EffectClaim =
  | { action: "cached"; effect_id: string; vector: number[] }
  | {
    action: "busy" | "held" | "stale";
    effect_id?: string;
    state?: "failed" | "unknown";
    reason?: EffectReason;
    attempts?: number;
  }
  | { action: "send" | "lookup"; effect_id: string; fence: number; key: string; attempts: number; job_id?: string };
export type ActiveEffectClaim = Extract<EffectClaim, { fence: number }>;
export interface PassageEffectLedger {
  claim(input: PassageEffectInput, capabilities: ProviderCapabilities, recomputeUnknown: boolean): Promise<EffectClaim>;
  complete(claim: ActiveEffectClaim, result: ProviderOutcome): Promise<boolean>;
}
export type PassageEffectResult =
  | { state: "succeeded"; vector: number[] }
  | { state: "busy" | "stale" }
  | { state: "failed" | "unknown"; reason: EffectReason; attempts: number };

/** DB claim commits key/attempt/fence before this use case makes any external call.
 * Only the explicitly bounded passage recomputation policy may opt into unknown resends.
 */
export async function executePassageEffect(
  ledger: PassageEffectLedger,
  provider: PassageProvider,
  input: PassageEffectInput,
  text: string,
  recomputeUnknown = false,
): Promise<PassageEffectResult> {
  const claim = await ledger.claim(input, provider.capabilities, recomputeUnknown);
  if (claim.action === "cached") return { state: "succeeded", vector: claim.vector };
  if (claim.action === "busy" || claim.action === "stale") return { state: claim.action };
  if (claim.action === "held") {
    return {
      state: claim.state ?? "unknown",
      reason: claim.reason ?? "unsupported_recovery",
      attempts: claim.attempts ?? 0,
    };
  }
  if (!("fence" in claim)) return { state: "stale" };
  let result: ProviderOutcome;
  try {
    result = claim.action === "lookup"
      ? await provider.lookup!(claim.job_id!, claim.key)
      : await provider.send(text, claim.key);
  } catch {
    // Never persist a provider exception, URL, credential, or input text.
    result = { state: "unknown", reason: "provider_unknown" };
  }
  // Storage exceptions escape: the external result remains unknown after lease recovery.
  if (!await ledger.complete(claim, result)) return { state: "stale" };
  if (result.state === "succeeded") return { state: "succeeded", vector: result.vector };
  if (result.state === "accepted") return { state: "unknown", reason: "provider_unknown", attempts: claim.attempts };
  return { ...result, attempts: claim.attempts };
}

export interface EffectStatus {
  effect_id: string;
  state: "pending" | "running" | "succeeded" | "failed" | "unknown";
  attempts: number;
  reason: EffectReason | null;
  start: number;
  end: number;
}
export interface EffectStatusReader {
  forRecord(actor: Actor, recordId: string): Promise<EffectStatus[]>;
}
/** Current owner authorization is checked by the store on every status read. */
export function passageEffectStatus(reader: EffectStatusReader, actor: Actor, recordId: string) {
  return reader.forRecord(actor, recordId);
}
