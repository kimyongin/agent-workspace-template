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
export type EffectReason =
  | "provider_unknown"
  | "transient"
  | "configuration"
  | "input_limit"
  | "invalid_response"
  | "retry_exhausted";
export type ProviderOutcome =
  | { state: "succeeded"; vector: number[] }
  | { state: "failed"; reason: "transient" | "configuration" | "input_limit" }
  | { state: "unknown"; reason: "provider_unknown" | "invalid_response" };
export interface PassageProvider {
  send(text: string): Promise<ProviderOutcome>;
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
  | { action: "send"; effect_id: string; fence: number; attempts: number };
export type ActiveEffectClaim = Extract<EffectClaim, { fence: number }>;
export interface PassageEffectLedger {
  claim(input: PassageEffectInput): Promise<EffectClaim>;
  complete(claim: ActiveEffectClaim, result: ProviderOutcome): Promise<boolean>;
}
export type PassageEffectResult =
  | { state: "succeeded"; vector: number[] }
  | { state: "busy" | "stale" }
  | { state: "failed" | "unknown"; reason: EffectReason; attempts: number };

/** DB claim commits attempt/fence before this use case makes any external call.
 * Unknown sends are recalculated within the same durable five-send limit.
 */
export async function executePassageEffect(
  ledger: PassageEffectLedger,
  provider: PassageProvider,
  input: PassageEffectInput,
  text: string,
): Promise<PassageEffectResult> {
  const claim = await ledger.claim(input);
  if (claim.action === "cached") return { state: "succeeded", vector: claim.vector };
  if (claim.action === "busy" || claim.action === "stale") return { state: claim.action };
  if (claim.action === "held") {
    return {
      state: claim.state ?? "unknown",
      reason: claim.reason ?? "provider_unknown",
      attempts: claim.attempts ?? 0,
    };
  }
  if (!("fence" in claim)) return { state: "stale" };
  let result: ProviderOutcome;
  try {
    result = await provider.send(text);
  } catch {
    // Never persist a provider exception, URL, credential, or input text.
    result = { state: "unknown", reason: "provider_unknown" };
  }
  // Storage exceptions escape: the external result remains unknown after lease recovery.
  if (!await ledger.complete(claim, result)) return { state: "stale" };
  if (result.state === "succeeded") return { state: "succeeded", vector: result.vector };
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
