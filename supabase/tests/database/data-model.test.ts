import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import {
  applyDataModel,
  exportDataModel,
  getDataModelChange,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntity } from "../../functions/_shared/core/entity/application.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { replayEntitySchemaImport } from "../../functions/_shared/core/entity-types/schema-import.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
const admin = connect(urls.admin), sql = connect(urls.direct, { max: 2, prepare: false });
const deps = { uow: new SqlDataModelUnitOfWork(sql) };
async function install(
  a: Parameters<typeof requestActor>[0],
  document: DataModelDocument,
  mode: "copy" | "update" = "copy",
) {
  const input = { mode, document: JSON.stringify(document) },
    review = await previewDataModel(deps, a, input),
    change = await prepareDataModel(deps, requestActor(a), { ...input, preview_fingerprint: review.fingerprint });
  return {
    review,
    change,
    applied: await applyDataModel(deps, requestActor(a), change.id, { expected_version: change.version }),
  };
}
dbTest(
  "whole model roundtrip preserves archived definitions and both relation roles without merging copies",
  async () => {
    const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      sample.entity_types[0].schema.deprecated = true;
      const first = await install(a.actor, sample);
      assertEquals(first.applied.status, "applied");
      const exported = await exportDataModel(deps, a.actor);
      assertEquals(exported.entity_types.length, 3);
      assertEquals(exported.relations.length, 2);
      assertEquals(exported.entity_types.filter((t) => t.schema.deprecated).length, 1);
      assertEquals(exported.relations[0].archived, false);
      const second = await install(a.actor, exported);
      assertEquals(
        second.review.mapping.types[exported.entity_types[0].ref] === exported.entity_types[0].schema["x-type-id"],
        false,
      );
      assertEquals((await exportDataModel(deps, a.actor)).entity_types.length, 6);
      const now = await exportDataModel(deps, a.actor), noop = await install(a.actor, now, "update");
      assertEquals(noop.review.items.every((i) => i.kind === "unchanged"), true);
      assertEquals(await exportDataModel(deps, a.actor), now);
      assertEquals((await exportDataModel(deps, b.actor)).entity_types, []);
      await assertRejects(() => getDataModelChange(deps, b.actor, first.change.id));
      assertEquals((await getDataModelChange(deps, a.actor, second.change.id)).result?.type_ids.length, 3);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);
dbTest("whole model aborts a late identity violation without publishing earlier compatible schemas", async () => {
  const a = await fixtureOwner(admin);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/openmarket.json")) as DataModelDocument;
    await install(a.actor, sample);
    const before = await exportDataModel(deps, a.actor),
      sku = before.entity_types.find((t) => t.schema.title === "판매 SKU")!;
    await createEntity({ uow: new SqlEntityUnitOfWork(sql) }, requestActor(a.actor), {
      entity_type_id: sku.schema["x-type-id"],
      schema_version: 1,
      source: "seller",
      external_id: "sku-1",
      properties: { prop_1: "등록 SKU" },
    });
    const original = await exportDataModel(deps, a.actor), changed = structuredClone(original);
    changed.entity_types[0].schema.description = "실패하면 게시되면 안 되는 변경";
    const target = changed.entity_types.find((t) => t.schema["x-type-id"] === sku.schema["x-type-id"])!;
    target.identity.default_source = "app";
    target.identity.sources = target.identity.sources.filter((s) => s.code !== "seller");
    const input = { mode: "update" as const, document: JSON.stringify(changed) },
      review = await previewDataModel(deps, a.actor, input),
      change = await prepareDataModel(deps, requestActor(a.actor), {
        ...input,
        preview_fingerprint: review.fingerprint,
      });
    await assertRejects(() =>
      applyDataModel(deps, requestActor(a.actor), change.id, { expected_version: change.version })
    );
    assertEquals(await exportDataModel(deps, a.actor), original);
    assertEquals((await getDataModelChange(deps, a.actor, change.id)).status, "ready");
  } finally {
    await a.cleanup();
  }
});
dbTest("retired single-kind import replays exact stored receipts but refuses new requests", async () => {
  const a = await fixtureOwner(admin);
  try {
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      actor = requestActor(a.actor),
      raw = { mode: "copy", document: "{}", preview_fingerprint: "b".repeat(64), new_keys: [], remove_keys: [] };
    const identity = await requestIdentity(actor, "entity-schema-import.prepare", null, raw);
    await asUser(sql, a.actor.userId, async (tx) => {
      await tx`select app.begin_request(${identity.key}::uuid,${identity.operation},${identity.fingerprint})`;
      await tx`select app.finish_request(${identity.key}::uuid,'{"changed":true,"historical":true}'::jsonb)`;
    });
    assertEquals((await replayEntitySchemaImport(d, actor, raw)).changed, true);
    await assertRejects(() => replayEntitySchemaImport(d, requestActor(a.actor), raw), Error, "전체 자료 모델");
  } finally {
    await a.cleanup();
  }
});
