import type postgres from "postgres";
import type { Actor } from "../../core/shared/actor.ts";
import type {
  ActiveEffectClaim,
  EffectClaim,
  EffectStatus,
  EffectStatusReader,
  PassageEffectInput,
  PassageEffectLedger,
  ProviderCapabilities,
  ProviderOutcome,
} from "../../core/search/external-effect.ts";
import { notFound } from "../../core/shared/errors.ts";
import { runAsActor } from "./sql-context.ts";

/** Only app_worker can call these narrowly scoped stored functions. Every call commits separately. */
export class SqlExternalEffectLedger implements PassageEffectLedger {
  constructor(private readonly sql: postgres.Sql) {}
  async claim(
    input: PassageEffectInput,
    capabilities: ProviderCapabilities,
    recomputeUnknown: boolean,
  ): Promise<EffectClaim> {
    const [row] = await this.sql`select app.claim_passage_effect(${input.message_id}::bigint,${input.pipeline},
      ${input.provider_scope},${input.model},${input.dimensions},${input.start},${input.end},${input.input_hash},
      ${capabilities.idempotency?.valid_for_seconds ?? null},${capabilities.lookup},${recomputeUnknown}) as effect`;
    return row.effect as EffectClaim;
  }
  async complete(claim: ActiveEffectClaim, result: ProviderOutcome): Promise<boolean> {
    const [row] = await this.sql`select app.complete_passage_effect(${claim.effect_id}::uuid,${claim.fence}::bigint,
      ${result.state},${"reason" in result ? result.reason : null},
      ${result.state === "succeeded" ? this.sql.json(result.vector) : null}::jsonb,
      ${"job_id" in result ? result.job_id ?? null : null}) as applied`;
    return row.applied as boolean;
  }
}
export class SqlEffectStatusReader implements EffectStatusReader {
  constructor(private readonly sql: postgres.Sql) {}
  forRecord(actor: Actor, recordId: string): Promise<EffectStatus[]> {
    return runAsActor(this.sql, actor, async (tx) => {
      try {
        const [row] = await tx`select app.record_passage_effect_status(${recordId}) as effects`;
        return row.effects as EffectStatus[];
      } catch (error) {
        if ((error as { code?: string }).code === "23503") throw notFound();
        throw error;
      }
    });
  }
}
