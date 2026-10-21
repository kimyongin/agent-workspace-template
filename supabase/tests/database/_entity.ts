import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import * as issuers from "../../functions/_shared/core/entity-issuers/application.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import type { IdentifierFieldSettings } from "../../functions/_shared/contracts/entity-identifiers.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { requestActor } from "../_request.ts";
import { connect, urls } from "./_db.ts";
import type postgres from "postgres";

/** Publish field settings through the same reviewed definition and worker boundary as normal callers. */
export async function configureIdentifierField(
  sql: postgres.Sql,
  actor: Actor,
  typeId: string,
  settings: IdentifierFieldSettings,
) {
  const deps = { uow: new SqlEntityTypeUnitOfWork(sql) };
  const current = await getEntitySchema(deps, actor, { type_id: typeId });
  const property_key = current.schema["x-identity-property"]!;
  const change = await changes.createEntitySchemaChange(deps, requestActor(actor), typeId, {
    expected_schema_version: current.schema_version,
    edits: [{
      op: "update_property",
      key: property_key,
      required: current.schema.required.includes(property_key),
      field: { ...current.schema.properties[property_key], "x-identifier": settings },
    }],
  });
  const analysis = await changes.analyzeEntitySchemaChange(deps, requestActor(actor), typeId, change.id, {
    expected_change_version: change.version,
  });
  const workerUrl = new URL(urls.admin);
  workerUrl.username = "app_worker";
  workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
  const worker = connect(workerUrl.href, { max: 1, prepare: false });
  try {
    for (let index = 0; index < 20; index++) {
      const batch = await worker.begin(async (tx) =>
        (await tx`select app.claim_entity_schema_analysis() as batch`)[0].batch
      );
      if (!batch) break;
      const convert = compileMigration(batch.target, batch.migration);
      const values = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
        convert(row.entity_id, row.properties)
      );
      await worker.begin(async (tx) => {
        await tx`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${tx.json(values)})`;
      });
    }
  } finally {
    await worker.end();
  }
  const reviewed = await changes.getEntitySchemaChange(deps, actor, typeId, change.id);
  await changes.applyEntitySchemaChange(deps, requestActor(actor), typeId, change.id, {
    expected_change_version: reviewed.version,
    analysis_id: analysis.analysis_id,
  });
  const definition = await getEntitySchema(deps, actor, { type_id: typeId });
  return { definition, property_key, schema: { entity_type_id: typeId, schema_version: definition.schema_version } };
}

/** Public registry and field-definition setup; this fixture does not translate retired API payloads. */
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
  const current = await getEntitySchema({ uow: new SqlEntityTypeUnitOfWork(sql) }, actor, { type_id: typeId });
  const settings = current.schema.properties[current.schema["x-identity-property"]!]["x-identifier"]!;
  const configured = await configureIdentifierField(sql, actor, typeId, {
    allowed_kind_ids: [...new Set([...settings.allowed_kind_ids, rule.id])],
    default_kind_id: rule.id,
  });
  return { deps, issuer, rule, ...configured };
}
