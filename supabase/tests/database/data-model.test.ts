import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
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
import { createEntity, deleteEntity } from "../../functions/_shared/core/entity/application.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
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
    const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      sample.entity_types[0].schema.deprecated = true;
      const first = await install(a.manager, sample);
      assertEquals(first.applied.status, "applied");
      const exported = await exportDataModel(deps, a.manager);
      assertEquals(exported.entity_types.length, 3);
      assertEquals(exported.relations.length, 2);
      assertEquals(exported.entity_types.filter((t) => t.schema.deprecated).length, 1);
      assertEquals(exported.relations[0].archived, false);
      const second = await install(a.manager, exported);
      assertEquals(
        second.review.mapping.types[exported.entity_types[0].ref] === exported.entity_types[0].schema["x-type-id"],
        false,
      );
      assertEquals((await exportDataModel(deps, a.manager)).entity_types.length, 6);
      const now = await exportDataModel(deps, a.manager);
      const effects = () =>
        runInWorkspace(sql, a.manager, {
          mode: "business",
          requirements: [{ target_kind: "settings", target_id: "*", access: "read" }],
        }, async (tx) => {
          const [row] =
            await tx`select (select count(*)::int from app.entity_schema_versions) as versions,(select count(*)::int from app.records) as records,(select count(*)::int from app.entity_schema_migrations) as jobs`;
          return row;
        });
      const beforeNoop = await effects(), noop = await install(a.manager, now, "update");
      assertEquals(await effects(), beforeNoop);
      assertEquals(noop.review.items.every((i) => i.kind === "unchanged"), true);
      assertEquals(noop.applied.result?.changed, false);
      assertEquals(noop.applied.result?.counts?.types, { added: 0, updated: 0, unchanged: 6 });
      assertEquals(await exportDataModel(deps, a.manager), now);
      assertEquals((await exportDataModel(deps, b.manager)).entity_types, []);
      await assertRejects(() => getDataModelChange(deps, b.manager, first.change.id));
      assertEquals((await getDataModelChange(deps, a.manager, second.change.id)).result?.type_ids.length, 3);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);
dbTest("whole model aborts a late identity reference without publishing earlier compatible schemas", async () => {
  const a = await businessWorkspaceFixture(admin, sql);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/openmarket.json")) as DataModelDocument;
    await install(a.manager, sample);
    const original = await exportDataModel(deps, a.manager);
    const sku = original.entity_types.find((t) => t.schema.title === "판매 SKU")!;
    await a.grantKind(a.manager, sku.schema["x-type-id"], "write");
    const changed = structuredClone(original);
    changed.entity_types[0].schema.description = "실패하면 게시되면 안 되는 변경";
    const target = changed.entity_types.find((t) => t.schema["x-type-id"] === sku.schema["x-type-id"])!;
    const selected = sku.schema["x-identity-property"]!;
    const sellerId = original.identity_definitions.rules.find((r) =>
      r.source === "seller" && sku.schema.properties[selected]["x-identifier"]!.allowed_kind_ids.includes(r.id)
    )!.id;
    target.schema.properties[selected]["x-identifier"] = {
      allowed_kind_ids: ["00000000-0000-4000-8000-000000000001"],
      default_kind_id: "00000000-0000-4000-8000-000000000001",
    };
    const input = { mode: "update" as const, document: JSON.stringify(changed) };
    const review = await previewDataModel(deps, a.manager, input);
    assertEquals(review.can_apply, true);
    const change = await prepareDataModel(deps, requestActor(a.manager), {
      ...input,
      preview_fingerprint: review.fingerprint,
    });
    // A valid public write introduces a reference after review. The frozen plan
    // remains immutable; final publication must recheck current references.
    const created = await createEntity({ uow: new SqlEntityUnitOfWork(sql) }, requestActor(a.manager), {
      entity_type_id: sku.schema["x-type-id"],
      schema_version: 1,
      properties: { prop_1: "등록 SKU", [selected]: `${sellerId}:sku-1` },
    });
    assertEquals((await previewDataModel(deps, a.manager, input)).can_apply, false);
    await deleteEntity({ uow: new SqlEntityUnitOfWork(sql) }, requestActor(a.manager), created.id, created.version);
    const removal = await previewDataModel(deps, a.manager, input);
    assertEquals(removal.can_apply, false);
    assertEquals(
      removal.items.find((item) =>
        item.ref === target.ref
      )?.kind,
      "conflict",
    );
    const replacement = structuredClone(original);
    const replacementType = replacement.entity_types.find((t) => t.schema["x-type-id"] === sku.schema["x-type-id"])!;
    const oldSource = replacementType.schema.properties[selected]["x-identifier"]!;
    const newRule = {
      ...replacement.identity_definitions.rules.find((rule) => rule.id === sellerId)!,
      id: crypto.randomUUID(),
      label: "새 판매자 번호",
    };
    replacement.identity_definitions.rules.push(newRule);
    oldSource.allowed_kind_ids = oldSource.allowed_kind_ids.map((id) => id === sellerId ? newRule.id : id);
    oldSource.default_kind_id = newRule.id;
    const rebound = await previewDataModel(deps, a.manager, { mode: "update", document: JSON.stringify(replacement) });
    assertEquals(rebound.can_apply, false);
    assertEquals(rebound.items.find((item) => item.ref === target.ref)?.kind, "conflict");
    await assertRejects(() =>
      applyDataModel(deps, requestActor(a.manager), change.id, { expected_version: change.version })
    );
    assertEquals(await exportDataModel(deps, a.manager), original);
    assertEquals((await getDataModelChange(deps, a.manager, change.id)).status, "ready");
  } finally {
    await a.cleanup();
  }
});

import { createEntitySchemaChange } from "../../functions/_shared/core/entity-types/schema-changes.ts";
dbTest(
  "whole model concurrent receipt replay and property reservations never duplicate or silently renumber",
  async () => {
    const a = await businessWorkspaceFixture(admin, sql);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      sample.entity_types = sample.entity_types.slice(0, 1);
      sample.relations = [];
      sample.entity_types[0].schema.properties = {
        prop_9: sample.entity_types[0].schema.properties.prop_1,
        prop_10: sample.entity_types[0].schema.properties[sample.entity_types[0].schema["x-identity-property"]!],
      };
      sample.entity_types[0].schema["x-identity-property"] = "prop_10";
      sample.entity_types[0].schema.required = ["prop_9", "prop_10"];
      sample.entity_types[0].schema["x-title-template"] = "$prop_9$";
      const input = { mode: "copy" as const, document: JSON.stringify(sample) },
        review = await previewDataModel(deps, a.manager, input),
        actor = requestActor(a.manager),
        prepared = { ...input, preview_fingerprint: review.fingerprint };
      const [one, two] = await Promise.all([
        prepareDataModel(deps, actor, prepared),
        prepareDataModel(deps, actor, prepared),
      ]);
      assertEquals(one, two);
      assertEquals(review.mapping.properties.ingredient, { prop_9: "prop_1", prop_10: "prop_2" });
      assertEquals(review.items.find((item) => item.ref === "ingredient")?.schema?.["x-title-template"], "$prop_1$");
      const publishActor = requestActor(a.manager),
        [left, right] = await Promise.all([
          applyDataModel(deps, publishActor, one.id, { expected_version: one.version }),
          applyDataModel(deps, publishActor, one.id, { expected_version: one.version }),
        ]);
      assertEquals(left, right);
      const before = await exportDataModel(deps, a.manager);
      assertEquals(before.entity_types.length, 1);
      assertEquals(before.entity_types[0].schema.required, ["prop_1", "prop_2"]);
      assertEquals(before.entity_types[0].schema["x-title-template"], "$prop_1$");
      await a.grantKind(a.manager, before.entity_types[0].schema["x-type-id"], "write");
      const changed = structuredClone(before), type = changed.entity_types[0];
      type.schema.properties.prop_99 = { type: "integer", "x-order": 40 };
      const update = { mode: "update" as const, document: JSON.stringify(changed) },
        p = await previewDataModel(deps, a.manager, update),
        c = await prepareDataModel(deps, requestActor(a.manager), { ...update, preview_fingerprint: p.fingerprint });
      await createEntitySchemaChange(
        { uow: new SqlEntityTypeUnitOfWork(sql) },
        requestActor(a.manager),
        type.schema["x-type-id"],
        {
          expected_schema_version: 1,
          edits: [{
            op: "add_property",
            client_ref: "reserve",
            field: { type: "integer", "x-order": 50 },
            required: false,
          }],
        },
      );
      await assertRejects(() => applyDataModel(deps, requestActor(a.manager), c.id, { expected_version: c.version }));
      assertEquals(await exportDataModel(deps, a.manager), before);
      const fresh = await previewDataModel(deps, a.manager, update);
      assertEquals(fresh.mapping.properties[type.ref].prop_99, "prop_99");
      const reused = structuredClone(before);
      reused.entity_types[0].schema.properties.prop_3 = { type: "integer", "x-order": 40 };
      await assertRejects(() =>
        previewDataModel(deps, a.manager, { mode: "update", document: JSON.stringify(reused) })
      );
    } finally {
      await a.cleanup();
    }
  },
);
dbTest(
  "whole model large multi-kind copy and whole update retain complete definitions with compact receipts",
  async () => {
    const a = await businessWorkspaceFixture(admin, sql);
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
      const first = await install(a.manager, sample), all = await exportDataModel(deps, a.manager);
      assertEquals(all.entity_types.length, 12);
      assertEquals(all.entity_types[0].schema.properties.prop_2.examples?.[44], "x".repeat(4096));
      assertEquals(JSON.stringify(first.change).length < 100000, true);
      for (const t of all.entity_types) t.schema.description = "전체 함께 변경";
      await install(a.manager, all, "update");
      const updated = await exportDataModel(deps, a.manager);
      assertEquals(updated.entity_types.every((t) => t.schema.description === "전체 함께 변경"), true);
    } finally {
      await a.cleanup();
    }
  },
);
import { jsonbText } from "../../functions/_shared/core/entity-types/schema-rules.ts";
dbTest("whole model requires explicit per-kind permanent removal and distinguishes stale source versions", async () => {
  const a = await businessWorkspaceFixture(admin, sql);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    sample.entity_types = sample.entity_types.slice(0, 1);
    sample.relations = [];
    await install(a.manager, sample);
    const d = await exportDataModel(deps, a.manager), type = d.entity_types[0];
    await a.grantKind(a.manager, type.schema["x-type-id"], "write");
    delete type.schema.properties.prop_2;
    const input = { mode: "update" as const, document: JSON.stringify(d) },
      p = await previewDataModel(deps, a.manager, input);
    assertEquals(p.items[0].removed_keys, ["prop_2"]);
    await assertRejects(() =>
      prepareDataModel(deps, requestActor(a.manager), { ...input, preview_fingerprint: p.fingerprint })
    );
    const c = await prepareDataModel(deps, requestActor(a.manager), {
      ...input,
      preview_fingerprint: p.fingerprint,
      remove_keys: { [type.ref]: ["prop_2"] },
    });
    await applyDataModel(deps, requestActor(a.manager), c.id, { expected_version: c.version });
    const current = await exportDataModel(deps, a.manager);
    assertEquals(Object.hasOwn(current.entity_types[0].schema.properties, "prop_2"), false);
    current.entity_types[0].schema["x-version"] = 1;
    const stale = await previewDataModel(deps, a.manager, { mode: "update", document: JSON.stringify(current) });
    assertEquals(stale.items[0].source_schema_version, 1);
    assertEquals(stale.items[0].current_schema_version, 2);
    assertEquals(stale.items[0].source_is_stale, true);
  } finally {
    await a.cleanup();
  }
});
dbTest("whole model keeps the existing exact 256 KiB kind definition boundary and compact receipts", async () => {
  const a = await businessWorkspaceFixture(admin, sql);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    sample.entity_types = sample.entity_types.slice(0, 1);
    sample.relations = [];
    const schema = sample.entity_types[0].schema;
    for (let n = 2; n <= 64; n++) {
      if (schema["x-identity-property"] === `prop_${n}`) continue;
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
    const copy = await install(a.manager, sample);
    assertEquals(JSON.stringify(copy.change).length < 16384, true);
    const exported = await exportDataModel(deps, a.manager);
    assertEquals(new TextEncoder().encode(jsonbText(exported.entity_types[0].schema)).length, 262144);
  } finally {
    await a.cleanup();
  }
});
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { updateEntityIssuer, updateIdentifierRule } from "../../functions/_shared/core/entity-issuers/application.ts";
dbTest(
  "whole model preserves raw non-default source activation across global suspension and previews referenced rule conflicts",
  async () => {
    const a = await businessWorkspaceFixture(admin, sql);
    try {
      const sample = JSON.parse(
        await Deno.readTextFile("docs/examples/data-model/openmarket.json"),
      ) as DataModelDocument;
      for (const t of sample.entity_types) {
        t.schema.properties[t.schema["x-identity-property"]!]["x-identifier"]!.default_kind_id =
          "00000000-0000-4000-8000-000000000001";
      }
      sample.identity_definitions.issuers.find((i) => i.code === "seller")!.active = false;
      await install(a.manager, sample);
      const exported = await exportDataModel(deps, a.manager),
        sku = exported.entity_types.find((t) => t.schema.title === "판매 SKU")!;
      const selected = sku.schema["x-identity-property"]!;
      const sellerKinds = (d: DataModelDocument, t: DataModelDocument["entity_types"][number]) =>
        d.identity_definitions.rules.filter((r) =>
          r.source === "seller" && t.schema.properties[selected]["x-identifier"]!.allowed_kind_ids.includes(r.id)
        );
      assertEquals(sellerKinds(exported, sku).length, 1);
      const copied = await install(a.manager, exported);
      const copiedSku = copied.review.mapping.types[sku.ref];
      const identities = { uow: new SqlEntityIssuerUnitOfWork(sql) };
      const seller = exported.identity_definitions.issuers.find((i) => i.code === "seller")!;
      await updateEntityIssuer(identities, requestActor(a.manager), "seller", {
        active: true,
        expected_version: seller.version,
      });
      const all = await exportDataModel(deps, a.manager),
        copyType = all.entity_types.find((t) => t.schema["x-type-id"] === copiedSku)!;
      await a.grantKind(a.manager, copiedSku, "write");
      await createEntity({ uow: new SqlEntityUnitOfWork(sql) }, requestActor(a.manager), {
        entity_type_id: copiedSku,
        schema_version: 1,
        properties: { prop_1: "다시 활성화된 SKU", [selected]: `${sellerKinds(all, copyType)[0].id}:reactivated-sku` },
      });
      const rule = all.identity_definitions.rules.find((r) => r.id === sellerKinds(all, copyType)[0].id)!;
      await updateIdentifierRule(identities, requestActor(a.manager), rule.id, {
        active: false,
        expected_version: rule.version,
      });
      const suspended = await exportDataModel(deps, a.manager);
      assertEquals(
        sellerKinds(suspended, suspended.entity_types.find((t) => t.schema["x-type-id"] === copiedSku)!).length,
        1,
      );
      const noop = await install(a.manager, suspended, "update");
      assertEquals(noop.applied.result?.changed, false);
      suspended.identity_definitions.rules.find((r) => r.id === rule.id)!.meaning = "참조 후 의미 변경은 불가";
      const conflict = await previewDataModel(deps, a.manager, { mode: "update", document: JSON.stringify(suspended) });
      assertEquals(conflict.can_apply, false);
      assertEquals(conflict.items.find((i) => i.ref === `rule:${rule.id}`)?.kind, "conflict");
    } finally {
      await a.cleanup();
    }
  },
);

import { listDataModelChanges } from "../../functions/_shared/core/data-model/application.ts";
import { SqlEntityRelationLinkUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-relation-link-store.ts";
import { connectEntityRelation } from "../../functions/_shared/core/entity-relations/links.ts";
import { getEntity } from "../../functions/_shared/core/entity/application.ts";
dbTest(
  "the original whole-model update file is a no-op on replay, with stable workspace-scoped IDs and sparse source keys",
  async () => {
    const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
    try {
      const doc = JSON.parse(await Deno.readTextFile("docs/examples/data-model/openmarket.json")) as DataModelDocument;
      doc.entity_types[0].schema.properties.prop_9 = { type: "string", title: "원본 유지 항목", "x-order": 9 };
      const first = await install(a.manager, doc, "update");
      const before = await exportDataModel(deps, a.manager);
      const second = await install(a.manager, doc, "update");
      assertEquals(second.review.items.every((i) => i.kind === "unchanged"), true);
      assertEquals(second.applied.result?.changed, false);
      assertEquals(await exportDataModel(deps, a.manager), before);
      assertEquals(second.review.mapping, first.review.mapping);
      assertEquals(second.review.mapping.properties[doc.entity_types[0].ref].prop_9, "prop_9");
      const other = await install(b.manager, doc, "update");
      assertEquals(other.applied.status, "applied");
      assertEquals(
        other.review.mapping.types[doc.entity_types[0].ref] === first.review.mapping.types[doc.entity_types[0].ref],
        false,
      );
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);
dbTest("model history scopes cursors to workspace and existing anchors and returns compact summaries", async () => {
  const a = await businessWorkspaceFixture(admin, sql), b = await businessWorkspaceFixture(admin, sql);
  try {
    const doc = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    await install(a.manager, doc, "update");
    await install(a.manager, doc, "update");
    const page = await listDataModelChanges(deps, a.manager, { limit: 1 });
    assertEquals(typeof page.next_cursor, "string");
    assertEquals(page.items[0].review.items[0].schema, undefined);
    assertEquals(Object.hasOwn(page.items[0].review.items[0], "identity"), false);
    await assertRejects(() => listDataModelChanges(deps, b.manager, { limit: 1, cursor: page.next_cursor! }));
    const second = await listDataModelChanges(deps, a.manager, { limit: 1, cursor: page.next_cursor! });
    assertEquals(second.items.length, 1);
    const detail = await getDataModelChange(deps, a.manager, page.items[0].id);
    assertEquals(!!detail.review.items[0].schema, true);
    await admin`delete from app.data_model_changes where workspace_id=${a.workspaceId}::uuid and id=${
      page.items[0].id
    }::uuid`;
    await assertRejects(() => listDataModelChanges(deps, a.manager, { limit: 1, cursor: page.next_cursor! }));
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
dbTest("model preview reports incompatible typed link cardinality before apply", async () => {
  const a = await businessWorkspaceFixture(admin, sql);
  try {
    const doc = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    const installed = await install(a.manager, doc, "update");
    const relation = installed.review.mapping.relations[doc.relations[0].id];
    const target = await exportDataModel(deps, a.manager);
    const def = target.relations.find((r) => r.id === relation)!;
    const ends = def.ends.map((e) => target.entity_types.find((t) => t.ref === e.type_ref)!.schema["x-type-id"]);
    for (const kind of new Set(ends)) await a.grantKind(a.manager, kind, "write");
    const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
    const create = (kind: string, name: string) =>
      createEntity(entityDeps, requestActor(a.manager), {
        entity_type_id: kind,
        schema_version: 1,
        properties: { prop_1: name },
      });
    const origin = await create(ends[0], "원점"),
      left = await create(ends[1], "연결1"),
      right = await create(ends[1], "연결2");
    for (const other of [left, right]) {
      const fresh = await getEntity(entityDeps, a.manager, origin.id);
      await connectEntityRelation({ uow: new SqlEntityRelationLinkUnitOfWork(sql) }, requestActor(a.manager), {
        definition_id: relation,
        side: 0,
        origin_id: fresh.id,
        other_id: other.id,
        expected_definition_version: 1,
        expected_version: fresh.version,
        expected_other_version: other.version,
      });
    }
    const changed = await exportDataModel(deps, a.manager);
    changed.relations.find((r) => r.id === relation)!.ends[0].cardinality = "one";
    const preview = await previewDataModel(deps, a.manager, { mode: "update", document: JSON.stringify(changed) });
    const item = preview.items.find((i) => i.ref === `relation:${relation}`)!;
    assertEquals(item.kind, "conflict");
    assertEquals(item.relation_impact?.links, 2);
    assertEquals(item.relation_impact?.left_many, true);
    assertEquals(preview.can_apply, false);
  } finally {
    await a.cleanup();
  }
});
