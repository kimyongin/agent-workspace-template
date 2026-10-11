import type postgres from "postgres";
import type {
  ActiveEffectClaim,
  EffectClaim,
  PassageEffectInput,
  PassageEffectLedger,
  ProviderOutcome,
} from "../../core/search/external-effect.ts";

/** Only app_worker can call these narrowly scoped stored functions. Every call commits separately. */
export class SqlExternalEffectLedger implements PassageEffectLedger {
  constructor(private readonly sql: postgres.Sql) {}
  async claim(
    input: PassageEffectInput,
  ): Promise<EffectClaim> {
    const [row] = await this.sql`select app.claim_passage_effect(${input.message_id}::bigint,${input.pipeline},
      ${input.provider_scope},${input.model},${input.dimensions},${input.start},${input.end},${input.input_hash}) as effect`;
    return row.effect as EffectClaim;
  }
  async complete(claim: ActiveEffectClaim, result: ProviderOutcome): Promise<boolean> {
    const [row] = await this.sql`select app.complete_passage_effect(${claim.effect_id}::uuid,${claim.fence}::bigint,
      ${result.state},${"reason" in result ? result.reason : null},
      ${result.state === "succeeded" ? this.sql.json(result.vector) : null}::jsonb) as applied`;
    return row.applied as boolean;
  }
}
