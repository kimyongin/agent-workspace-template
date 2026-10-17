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
import { createEntitySchemaChange } from "../../functions/_shared/core/entity-types/schema-changes.ts";
dbTest(
  "whole model concurrent receipt replay and property reservations never duplicate or silently renumber",
  async () => {
    const a = await fixtureOwner(admin);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      sample.entity_types = sample.entity_types.slice(0, 1);
      sample.relations = [];
      sample.entity_types[0].schema.properties = { prop_9: sample.entity_types[0].schema.properties.prop_1 };
      sample.entity_types[0].schema.required = ["prop_9"];
      const input = { mode: "copy" as const, document: JSON.stringify(sample) },
        review = await previewDataModel(deps, a.actor, input),
        actor = requestActor(a.actor),
        prepared = { ...input, preview_fingerprint: review.fingerprint };
      const [one, two] = await Promise.all([
        prepareDataModel(deps, actor, prepared),
        prepareDataModel(deps, actor, prepared),
      ]);
      assertEquals(one, two);
      assertEquals(review.mapping.properties.ingredient, { prop_9: "prop_1" });
      const publishActor = requestActor(a.actor),
        [left, right] = await Promise.all([
          applyDataModel(deps, publishActor, one.id, { expected_version: one.version }),
          applyDataModel(deps, publishActor, one.id, { expected_version: one.version }),
        ]);
      assertEquals(left, right);
      const before = await exportDataModel(deps, a.actor);
      assertEquals(before.entity_types.length, 1);
      assertEquals(before.entity_types[0].schema.required, ["prop_1"]);
      const changed = structuredClone(before), type = changed.entity_types[0];
      type.schema.properties.prop_99 = { type: "integer", "x-order": 30 };
      const update = { mode: "update" as const, document: JSON.stringify(changed) },
        p = await previewDataModel(deps, a.actor, update),
        c = await prepareDataModel(deps, requestActor(a.actor), { ...update, preview_fingerprint: p.fingerprint });
      await createEntitySchemaChange(
        { uow: new SqlEntityTypeUnitOfWork(sql) },
        requestActor(a.actor),
        type.schema["x-type-id"],
        {
          expected_schema_version: 1,
          edits: [{
            op: "add_property",
            client_ref: "reserve",
            field: { type: "integer", "x-order": 40 },
            required: false,
          }],
        },
      );
      await assertRejects(() => applyDataModel(deps, requestActor(a.actor), c.id, { expected_version: c.version }));
      assertEquals(await exportDataModel(deps, a.actor), before);
      const fresh = await previewDataModel(deps, a.actor, update);
      assertEquals(fresh.mapping.properties[type.ref].prop_99, "prop_3");
      const reused = structuredClone(before);
      reused.entity_types[0].schema.properties.prop_2 = { type: "integer", "x-order": 30 };
      await assertRejects(() => previewDataModel(deps, a.actor, { mode: "update", document: JSON.stringify(reused) }));
    } finally {
      await a.cleanup();
    }
  },
);
dbTest(
  "whole model large multi-kind copy and whole update retain complete definitions with compact receipts",
  async () => {
    const a = await fixtureOwner(admin);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument,
        base = sample.entity_types[0];
      sample.relations = [];
      sample.entity_types = Array.from({ length: 12 }, (_, n) => {
        const t = structuredClone(base);
        t.ref = `large_${n}`;
        t.schema["x-type-id"] = `60000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
        t.schema.title = `큰 종류 ${n}`;
        t.schema.properties.prop_2 = {
          type: "string",
          "x-order": 20,
          examples: Array.from({ length: 45 }, () => "x".repeat(4096)),
        };
        return t;
      });
      const first = await install(a.actor, sample), all = await exportDataModel(deps, a.actor);
      assertEquals(all.entity_types.length, 12);
      assertEquals(all.entity_types[0].schema.properties.prop_2.examples?.[44], "x".repeat(4096));
      assertEquals(JSON.stringify(first.change).length < 100000, true);
      for (const t of all.entity_types) t.schema.description = "전체 함께 변경";
      await install(a.actor, all, "update");
      const updated = await exportDataModel(deps, a.actor);
      assertEquals(updated.entity_types.every((t) => t.schema.description === "전체 함께 변경"), true);
    } finally {
      await a.cleanup();
    }
  },
);
import { jsonbText } from "../../functions/_shared/core/entity-types/schema-rules.ts";
dbTest("whole model requires explicit per-kind permanent removal and distinguishes stale source versions", async () => {
  const a = await fixtureOwner(admin);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    sample.entity_types = sample.entity_types.slice(0, 1);
    sample.relations = [];
    await install(a.actor, sample);
    const d = await exportDataModel(deps, a.actor), type = d.entity_types[0];
    delete type.schema.properties.prop_2;
    const input = { mode: "update" as const, document: JSON.stringify(d) },
      p = await previewDataModel(deps, a.actor, input);
    assertEquals(p.items[0].removed_keys, ["prop_2"]);
    await assertRejects(() =>
      prepareDataModel(deps, requestActor(a.actor), { ...input, preview_fingerprint: p.fingerprint })
    );
    const c = await prepareDataModel(deps, requestActor(a.actor), {
      ...input,
      preview_fingerprint: p.fingerprint,
      remove_keys: { [type.ref]: ["prop_2"] },
    });
    await applyDataModel(deps, requestActor(a.actor), c.id, { expected_version: c.version });
    const current = await exportDataModel(deps, a.actor);
    assertEquals(Object.hasOwn(current.entity_types[0].schema.properties, "prop_2"), false);
    current.entity_types[0].schema["x-version"] = 1;
    const stale = await previewDataModel(deps, a.actor, { mode: "update", document: JSON.stringify(current) });
    assertEquals(stale.items[0].source_schema_version, 1);
    assertEquals(stale.items[0].current_schema_version, 2);
    assertEquals(stale.items[0].source_is_stale, true);
  } finally {
    await a.cleanup();
  }
});
dbTest("whole model keeps the existing exact 256 KiB kind definition boundary and compact receipts", async () => {
  const a = await fixtureOwner(admin);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    sample.entity_types = sample.entity_types.slice(0, 1);
    sample.relations = [];
    const schema = sample.entity_types[0].schema;
    for (let n = 2; n <= 64; n++) {
      schema.properties[`prop_${n}`] = {
        type: "string",
        "x-order": n * 10,
        oneOf: Array.from(
          { length: 4 },
          (_, i) => ({ const: String(i).padStart(3, "0") + "a".repeat(900), title: "옵션" }),
        ),
      };
    }
    const bytes = () => new TextEncoder().encode(jsonbText(schema)).length;
    for (const option of Object.values(schema.properties).flatMap((f) => f.oneOf ?? [])) {
      option.const += "a".repeat(Math.min(4096 - option.const!.length, 262144 - bytes()));
      if (bytes() === 262144) break;
    }
    assertEquals(bytes(), 262144);
    const copy = await install(a.actor, sample);
    assertEquals(JSON.stringify(copy.change).length < 16384, true);
    const exported = await exportDataModel(deps, a.actor);
    assertEquals(new TextEncoder().encode(jsonbText(exported.entity_types[0].schema)).length, 262144);
  } finally {
    await a.cleanup();
  }
});
