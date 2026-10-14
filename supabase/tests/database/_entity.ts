import {
  SqlEntityIssuerStore,
  SqlEntityIssuerUnitOfWork,
} from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import * as issuers from "../../functions/_shared/core/entity-issuers/application.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { requestActor } from "../_request.ts";
import type postgres from "postgres";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";

/** Explicit owner-scoped test setup; production reads never create types or definitions. */
export async function entityFixture(sql: postgres.Sql, owner: string) {
  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${owner + ":typed-entity-fixture"},0))`;
    const [existing] = await tx`select id,schema_version from app.entity_types where owner_id=${owner}
      and label='검사 자료' order by created_at,id limit 1`;
    if (existing) {
      const [identity] =
        await tx`select 1 from app.entity_type_identity where owner_id=${owner} and type_id=${existing.id}`;
      if (!identity) await new SqlEntityIssuerStore(tx, { userId: owner }).initializeTypeIdentity(existing.id);
      return { entity_type_id: String(existing.id), schema_version: Number(existing.schema_version) };
    }
    const definition = initialEntityDefinition("속성 1");
    definition.schema.properties = {
      prop_1: { type: "string", title: "속성 1", minLength: 1, maxLength: 100 },
      prop_2: { type: ["integer", "null"], title: "속성 2", minimum: 0, maximum: 1_000_000, default: null },
      prop_3: { type: ["string", "null"], title: "속성 3", format: "date", default: null },
      prop_4: { type: "string", title: "속성 4", enum: ["a", "b", "c"], default: "a" },
    };
    definition.display.order = ["prop_1", "prop_2", "prop_3", "prop_4"];
    definition.display.list_columns = ["prop_1", "prop_2", "prop_3"];
    const [type] = await tx`insert into app.entity_types(owner_id,label,next_property_number)
      values(${owner},'검사 자료',5) returning id`;
    await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display)
      values(${owner},${type.id},1,${tx.json(definition.schema as never)},${tx.json(definition.display as never)})`;
    await new SqlEntityIssuerStore(tx, { userId: owner }).initializeTypeIdentity(type.id);
    return { entity_type_id: String(type.id), schema_version: 1 };
  });
}

/** Public registry setup for a direct-number issuer supported by this owner's type. */
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
