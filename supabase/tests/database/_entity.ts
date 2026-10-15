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
    const [existing] =
      await tx`select t.id,t.schema_version from app.entity_types t join app.entity_schema_versions s on s.owner_id=t.owner_id and s.type_id=t.id and s.schema_version=t.schema_version where t.owner_id=${owner}
      and s.schema->>'title'='검사 자료' order by t.created_at,t.id limit 1`;
    if (existing) {
      const [identity] =
        await tx`select 1 from app.entity_type_identity where owner_id=${owner} and type_id=${existing.id}`;
      if (!identity) await new SqlEntityIssuerStore(tx, { userId: owner }).initializeTypeIdentity(existing.id);
      return { entity_type_id: String(existing.id), schema_version: Number(existing.schema_version) };
    }
    const definition = initialEntityDefinition("속성 1");
    definition.schema.properties = {
      prop_1: {
        type: "string",
        title: "속성 1",
        minLength: 1,
        maxLength: 100,
        "x-order": 10,
        "x-representative": true,
        "x-show-in-list": true,
      },
      prop_2: {
        type: ["integer", "null"],
        title: "속성 2",
        minimum: 0,
        maximum: 1_000_000,
        default: null,
        "x-order": 20,
        "x-show-in-list": true,
      },
      prop_3: {
        type: ["string", "null"],
        title: "속성 3",
        format: "date",
        default: null,
        "x-order": 30,
        "x-show-in-list": true,
      },
      prop_4: {
        type: "string",
        title: "속성 4",
        oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
        default: "a",
        "x-order": 40,
      },
    };
    const [type] = await tx`insert into app.entity_types(owner_id,next_property_number)
      values(${owner},5) returning id`;
    definition.schema["x-type-id"] = String(type.id);
    definition.schema.title = "검사 자료";
    await tx`insert into app.entity_schema_versions(owner_id,schema)
      values(${owner},${tx.json(definition.schema as never)})`;
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
