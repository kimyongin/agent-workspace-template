import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import * as issuers from "../../functions/_shared/core/entity-issuers/application.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { requestActor } from "../_request.ts";
import type postgres from "postgres";

/** Public registry setup for a direct-number issuer supported by the explicitly scoped type. */
export async function directEntitySource(
  sql: postgres.Sql,
  actor: Actor,
  typeId: string,
  code = "crm",
  label = "고객 시스템",
) {
  const deps = { uow: new SqlEntityIssuerUnitOfWork(sql) };
  const issuer = (await issuers.listEntityIssuers(deps, actor)).items.find((value) => value.code === code) ??
    await issuers.createEntityIssuer(deps, requestActor(actor), { code, label });
  const rule =
    (await issuers.listIdentifierRules(deps, actor, code)).items.find((value) =>
      value.meaning === "발급처 원본 자료 번호"
    ) ??
      await issuers.createIdentifierRule(deps, requestActor(actor), code, {
        label: "원본 번호",
        meaning: "발급처 원본 자료 번호",
      });
  const current = await issuers.getEntityTypeIdentity(deps, actor, typeId);
  const identity = await issuers.updateEntityTypeIdentity(deps, requestActor(actor), typeId, {
    label: "번호",
    default_source: code,
    expected_version: current.version,
    sources: [...current.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })), {
      code,
      rule_id: rule.id,
      active: true,
    }],
  });
  return { deps, issuer, rule, identity };
}
