import { assertEquals } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import * as model from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import * as settings from "../../functions/_shared/core/settings/application.ts";
async function modelPublication(scenario: "new" | "existing" | "stale" | "failure") {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
  const url = new URL(urls.admin);
  url.username = "app_worker";
  url.password = Deno.env.get("APP_WORKER_PASSWORD")!;
  const worker = connect(url.href, { max: 1, prepare: false });
  const f = await businessWorkspaceFixture(admin, sql),
    deps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) },
    entities = { uow: new SqlEntityUnitOfWork(sql) };
  const actor = () => businessRequest(f.manager);
  try {
    const type = await f.createKind("모델 식별자 변환");
    await f.grantKind(f.manager, type.id, "write");
    await settings.updateBusinessSettings(
      {
        uow: new SqlBusinessSettingsUnitOfWork(sql),
        clock: { now: () => new Date() },
      },
      actor(),
      {
        id: "record_templates",
        expected_version: 0,
        value: { entity_types: { [type.id]: { update: { memo: "식별자 모델 변환" } } } },
      },
    );
    const row = await entity.createEntity(entities, actor(), {
      entity_type_id: type.id,
      schema_version: 1,
      properties: { prop_1: "원본" },
    });
    const registries = { uow: new SqlEntityIssuerUnitOfWork(sql) };
    await registry.createEntityIssuer(registries, actor(), { code: "seller", label: "판매자" });
    const existing = await registry.createIdentifierRule(registries, actor(), "seller", {
      label: "기존 번호",
      meaning: "기존 번호 의미",
    });
    const original = await model.exportDataModel(deps, f.manager),
      target = structuredClone(original),
      kindId = scenario === "existing" ? existing.id : crypto.randomUUID();
    if (scenario === "existing") {
      target.identity_definitions.rules.find((r) => r.id === existing.id)!.label = "바뀐 번호 이름";
    } else {target.identity_definitions.rules.push({
        id: kindId,
        source: "seller",
        label: "SKU",
        meaning: "판매자 SKU",
        generation: "direct",
        active: true,
        version: 1,
      });}
    const schema = target.entity_types[0].schema;
    schema.properties.prop_3 = {
      type: "string",
      title: "외부 번호",
      "x-order": 30,
      "x-identifier": { allowed_kind_ids: [kindId], default_kind_id: kindId },
    };
    schema.required.push("prop_3");
    const input = { mode: "update", document: JSON.stringify(target) },
      review = await model.previewDataModel(deps, f.manager, input);
    const mapped = review.mapping.rules[kindId], pair = mapped + ":한:글";
    const change = await model.prepareDataModel(deps, actor(), { ...input, preview_fingerprint: review.fingerprint });
    const analyzing = await analyzeDataModel(deps, actor(), change.id, {
      expected_version: change.version,
      conversions: [{
        type_ref: target.entity_types[0].ref,
        migration: { rules: [{ key: "prop_3", op: "fill", value: pair }], overrides: [] },
      }],
    });
    assertEquals(analyzing.status, "analyzing");
    const [claim] = await worker`select app.claim_entity_schema_analysis() as batch`;
    const batch = claim.batch, convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
    await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
      worker.json(batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
        convert(r.entity_id, r.properties)
      ))
    })`;
    const ready = await model.getDataModelChange(deps, f.manager, change.id);
    assertEquals(ready.group!.children[0].change.analysis!.failed, 0);
    assertEquals(ready.status, "ready");
    await model.applyDataModel(deps, actor(), change.id, { expected_version: ready.version });
    let committed = false;
    let staged = false;
    for (let step = 0; step < 10; step++) {
      const [claimed] = await worker`select app.claim_data_model_conversion() as batch`;
      const b = claimed.batch;
      if (!b) break;
      if (b.status === "committing") {
        assertEquals(staged, true);
        assertEquals(await model.exportDataModel(deps, f.manager), original);
        assertEquals((await entity.getEntity(entities, f.manager, row.id)).properties, row.properties);
        if (scenario === "stale") {
          await registry.updateIdentifierRule(registries, actor(), existing.id, {
            expected_version: existing.version,
            label: "경쟁 수정",
          });
        }
        if (scenario === "failure") {
          const [collision] =
            await admin`select r.record_id from app.data_model_children c join private.entity_schema_migration_rows r on r.workspace_id=c.workspace_id and r.job_id=c.job_id where c.workspace_id=${f.workspaceId} and c.model_id=${change.id}`;
          const recordId = collision.record_id;
          await admin.begin(async (tx) => {
            await tx`select set_config('request.workspace_id',${f.workspaceId},true)`;
            await tx`insert into app.records(workspace_id,id,entity_id,body,created_by,created_by_name,record_kind) values(${f.workspaceId},${recordId},${row.id},'충돌 기록',${f.manager.userId},'검증','result')`;
          });
        }
        const [result] =
          await worker`select app.commit_data_model_conversion(${b.id},${b.fence},${SEARCH_PIPELINE}) as committed`;
        committed = result.committed;
        break;
      }
      const child = b.child;
      const prepared = await prepareMigrationBatch(child, new Date());
      staged = true;
      await worker`select app.stage_data_model_conversion(${b.id},${b.fence},${child.id},${child.fence},${
        worker.json(prepared.results as never)
      })`;
    }
    if (scenario === "stale" || scenario === "failure") {
      assertEquals(committed, false);
      const after = await entity.getEntity(entities, f.manager, row.id);
      assertEquals(after.properties, row.properties);
      assertEquals(after.schema_version, 1);
      const exported = await model.exportDataModel(deps, f.manager);
      assertEquals(exported.entity_types, original.entity_types);
      assertEquals(exported.identity_definitions.rules.some((r) => r.id === mapped), false);
      assertEquals((await model.getDataModelChange(deps, f.manager, change.id)).status, "failed");
      return;
    }
    assertEquals(committed, true);
    const after = await entity.getEntity(entities, f.manager, row.id);
    assertEquals(after.properties.prop_3, pair);
    assertEquals(after.properties.prop_2, row.properties.prop_2);
    assertEquals(after.id, row.id);
    const exported = await model.exportDataModel(deps, f.manager);
    assertEquals(exported.identity_definitions.rules.some((r) => r.id === mapped), true);
    assertEquals(exported.entity_types[0].schema["x-identity-property"], "prop_2");
    assertEquals(Object.hasOwn(exported.entity_types[0], "identity"), false);
  } finally {
    await f.cleanup();
    await sql.end();
    await worker.end();
    await admin.end();
  }
}
for (
  const [scenario, name] of [
    [
      "new",
      "whole model atomically publishes a new identifier kind and exact-pair conversion without replacing selected identities",
    ],
    ["existing", "whole model atomically publishes an approved existing kind label change with its conversions"],
    ["stale", "whole model refuses a registry competitor after staging without partial kind or schema publication"],
    [
      "failure",
      "whole model rolls back newly published registry rows and all converted values after a late record failure",
    ],
  ] as const
) dbTest(name, () => modelPublication(scenario));
