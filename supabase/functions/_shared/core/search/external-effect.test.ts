import { assertEquals } from "@std/assert";
import { executePassageEffect, type PassageEffectLedger, type PassageProvider } from "./external-effect.ts";

Deno.test("passage effect: durable success skips provider and provider errors remain unknown", async () => {
  let sends = 0;
  const vector = [1, 0];
  const provider: PassageProvider = {
    send: () => {
      sends++;
      return Promise.reject(new Error("secret provider body"));
    },
  };
  let saved: unknown;
  const ledger: PassageEffectLedger = {
    claim: () => Promise.resolve({ action: "cached", effect_id: "effect", vector }),
    complete: (_claim, result) => {
      saved = result;
      return Promise.resolve(true);
    },
  };
  const input = {
    message_id: "1",
    pipeline: "p",
    provider_scope: "s",
    model: "m",
    dimensions: 2,
    start: 0,
    end: 4,
    input_hash: "a".repeat(64),
  };
  assertEquals(await executePassageEffect(ledger, provider, input, "body"), { state: "succeeded", vector });
  assertEquals(sends, 0);
  ledger.claim = () => Promise.resolve({ action: "send", effect_id: "effect", fence: 1, attempts: 1 });
  assertEquals(await executePassageEffect(ledger, provider, input, "body"), {
    state: "unknown",
    reason: "provider_unknown",
    attempts: 1,
  });
  assertEquals(saved, { state: "unknown", reason: "provider_unknown" });
});
