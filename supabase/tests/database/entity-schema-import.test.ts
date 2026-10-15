import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { type EntitySchema, initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import type { EntityTypeDeps, EntityTypeStore } from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntityType,
  getEntitySchema,
  getEntityType,
  updateEntityType,
} from "../../functions/_shared/core/entity-types/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import {
  prepareEntitySchemaImport,
  previewEntitySchemaImport,
} from "../../functions/_shared/core/entity-types/schema-import.ts";
import { jsonbText } from "../../functions/_shared/core/entity-types/schema-rules.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

async function fixture() {
  const admin = connect(urls.admin), sql = connect(urls.direct, { max: 6 });
  const a = await fixtureOwner(admin), b = await fixtureOwner(admin), deps = { uow: new SqlEntityTypeUnitOfWork(sql) };
  const effects = async (owner = a.actor.userId) =>
    (await admin`select
    (select count(*)::int from app.entity_types where owner_id=${owner}) as types,
    (select count(*)::int from app.entity_schema_versions where owner_id=${owner}) as versions,
    (select count(*)::int from app.entity_type_identity where owner_id=${owner}) as identities,
    (select count(*)::int from app.entity_schema_changes where owner_id=${owner}) as drafts,
    (select count(*)::int from app.records where owner_id=${owner}) as records,
    (select count(*)::int from private.request_results where owner_id=${owner}) as receipts`)[0];
  const actor = () => requestActor(a.actor);
  async function publish(typeId: string, edits: unknown[]) {
    const type = await getEntityType(deps, a.actor, typeId);
    const change = await createEntitySchemaChange(deps, actor(), typeId, {
      expected_schema_version: type.schema_version,
      edits,
    });
    const analysis = await analyzeEntitySchemaChange(deps, actor(), typeId, change.id, {
      expected_change_version: change.version,
    });
    await applyEntitySchemaChange(deps, actor(), typeId, change.id, {
      expected_change_version: change.version,
      analysis_id: analysis.analysis_id,
    });
    return getEntitySchema(deps, a.actor, { type_id: typeId });
  }
  return {
    admin,
    sql,
    a,
    b,
    deps,
    effects,
    actor,
    publish,
    cleanup: async () => {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    },
  };
}
async function rejectsCode(fn: () => Promise<unknown>, code: string) {
  assertEquals((await assertRejects(fn, AppError)).code, code);
}

dbTest(
  "schema import copy: concurrent same-key replay issues one new ID and required-key mapping, and failure rolls back the entire copy",
  async () => {
    const f = await fixture();
    try {
      const source =
        initialEntityDefinition("원본 코드", { id: crypto.randomUUID(), title: "복사한 종류", icon: "star" }).schema;
      source["x-version"] = 17;
      source.properties = { prop_9: source.properties.prop_1, prop_42: { type: "integer", "x-order": 20, default: 7 } };
      source.required = ["prop_9", "prop_42"];
      const input = { mode: "copy", document: JSON.stringify(source, null, 2) }, before = await f.effects();
      const review = await previewEntitySchemaImport(f.deps, f.a.actor, input);
      assertEquals(review.key_mapping, { prop_9: "prop_1", prop_42: "prop_2" });
      assertEquals(await f.effects(), before);
      const actor = f.actor(), prepare = { ...input, preview_fingerprint: review.preview_fingerprint };
      const [first, second] = await Promise.all([
        prepareEntitySchemaImport(f.deps, actor, prepare),
        prepareEntitySchemaImport(f.deps, actor, prepare),
      ]);
      assertEquals(first, second);
      assert(first.type?.id !== source["x-type-id"]);
      assert(first.type);
      assertEquals(first.type.next_property_number, 3);
      const saved = await getEntitySchema(f.deps, f.a.actor, { type_id: first.type.id });
      assertEquals(saved.schema, {
        ...source,
        "x-type-id": first.type.id,
        "x-version": 1,
        properties: { prop_1: source.properties.prop_9, prop_2: source.properties.prop_42 },
        required: ["prop_1", "prop_2"],
      });
      assertEquals(await f.effects(), { types: 1, versions: 1, identities: 1, drafts: 0, records: 0, receipts: 1 });
      assertEquals(await prepareEntitySchemaImport(f.deps, actor, prepare), first);
      const copied = await f.effects();
      await rejectsCode(() => prepareEntitySchemaImport(f.deps, f.actor(), prepare), "invalid_input");
      assertEquals(await f.effects(), copied);

      const failedSource = { ...source, title: "저장 취소될 종류" },
        failedInput = { mode: "copy", document: JSON.stringify(failedSource) };
      const failedReview = await previewEntitySchemaImport(f.deps, f.a.actor, failedInput);
      // Fail the unit of work after the copy has inserted its schema and identity defaults.
      const failing: EntityTypeDeps = {
        uow: {
          run: (actor, fn) =>
            f.deps.uow.run(actor, (store) =>
              fn(
                new Proxy(store, {
                  get(target, property, receiver) {
                    const value = Reflect.get(target, property, receiver);
                    if (property === "createImportedType") {
                      return async (schema: EntitySchema) => {
                        await target.createImportedType(schema);
                        throw Error("copy before commit");
                      };
                    }
                    return typeof value === "function" ? value.bind(target) : value;
                  },
                }) as EntityTypeStore,
              )),
        },
      };
      const failedActor = f.actor();
      await rejectsCode(
        () =>
          prepareEntitySchemaImport(failing, failedActor, {
            ...failedInput,
            preview_fingerprint: failedReview.preview_fingerprint,
          }),
        "internal",
      );
      assertEquals(await f.effects(), copied);
      const retry = await prepareEntitySchemaImport(f.deps, failedActor, {
        ...failedInput,
        preview_fingerprint: failedReview.preview_fingerprint,
      });
      assert(retry.type);
      assertEquals(await f.effects(), { types: 2, versions: 2, identities: 2, drafts: 0, records: 0, receipts: 2 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "schema import preview is read-only; semantic no-op keeps current version, records and drafts; foreign-owner update stays isolated",
  async () => {
    const f = await fixture();
    try {
      const type = await createEntityType(f.deps, f.actor(), { label: "현재 종류" });
      await updateEntityType(f.deps, f.actor(), type.id, { expected_schema_version: 1, label: "새 이름" });
      const current = await getEntitySchema(f.deps, f.a.actor, { type_id: type.id }),
        document = structuredClone(current.schema);
      document["x-version"] = 1;
      document.properties.prop_1.readOnly = false;
      const input = {
          mode: "update",
          type_id: type.id,
          expected_schema_version: 2,
          document: JSON.stringify(document, null, 2),
        },
        before = await f.effects();
      const review = await previewEntitySchemaImport(f.deps, f.a.actor, input);
      assertEquals([
        review.changed,
        review.source_is_stale,
        review.source_schema_version,
        review.current_schema_version,
      ], [false, true, 1, 2]);
      assertEquals(await f.effects(), before);
      const counter = (await getEntityType(f.deps, f.a.actor, type.id)).next_property_number;
      const result = await prepareEntitySchemaImport(f.deps, f.actor(), {
        ...input,
        preview_fingerprint: review.preview_fingerprint,
      });
      assertEquals(result.change, null);
      const after = await f.effects();
      assertEquals({ ...after, receipts: before.receipts }, before);
      assertEquals((await getEntityType(f.deps, f.a.actor, type.id)).next_property_number, counter);
      assertEquals((await getEntitySchema(f.deps, f.a.actor, { type_id: type.id })).schema, current.schema);
      await rejectsCode(() => previewEntitySchemaImport(f.deps, f.b.actor, input), "not_found");
      await rejectsCode(
        () =>
          prepareEntitySchemaImport(f.deps, requestActor(f.b.actor), {
            ...input,
            preview_fingerprint: review.preview_fingerprint,
          }),
        "not_found",
      );
      assertEquals(await f.effects(f.b.actor.userId), {
        types: 0,
        versions: 0,
        identities: 0,
        drafts: 0,
        records: 0,
        receipts: 0,
      });
    } finally {
      await f.cleanup();
    }
  },
);

for (const scenario of ["reserved", "deleted"] as const) {
  dbTest(
    `schema import ${scenario} property identity requires explicit remapping and repreparation keeps its reserved key`,
    async () => {
      const f = await fixture();
      try {
        const type = await createEntityType(f.deps, f.actor(), { label: `키 보존 ${scenario}` });
        let document = (await getEntitySchema(f.deps, f.a.actor, { type_id: type.id })).schema;
        if (scenario === "reserved") {
          await createEntitySchemaChange(f.deps, f.actor(), type.id, {
            expected_schema_version: 1,
            edits: [{ op: "add_property", client_ref: "abandoned", field: { type: "string", "x-order": 20 } }],
          });
          document = {
            ...document,
            properties: { ...document.properties, prop_2: { type: "string", "x-order": 20 } },
            required: ["prop_1", "prop_2"],
          };
        } else {
          document = (await f.publish(type.id, [{
            op: "add_property",
            client_ref: "old",
            field: { type: "string", "x-order": 20 },
            required: false,
          }])).schema;
          await f.publish(type.id, [{ op: "remove_property", key: "prop_2" }]);
        }
        const current = await getEntityType(f.deps, f.a.actor, type.id),
          base = {
            mode: "update",
            type_id: type.id,
            expected_schema_version: current.schema_version,
            document: JSON.stringify(document),
          };
        assertEquals(current.next_property_number, 3);
        await rejectsCode(() => previewEntitySchemaImport(f.deps, f.a.actor, base), "invalid_input");
        const input = { ...base, new_keys: ["prop_2"] },
          before = await f.effects(),
          review = await previewEntitySchemaImport(f.deps, f.a.actor, input);
        assertEquals(review.key_mapping, { prop_1: "prop_1", prop_2: "prop_3" });
        assertEquals(review.source_is_stale, scenario === "deleted");
        assertEquals(await f.effects(), before);
        assertEquals((await getEntityType(f.deps, f.a.actor, type.id)).next_property_number, 3);
        const first = await prepareEntitySchemaImport(f.deps, f.actor(), {
          ...input,
          preview_fingerprint: review.preview_fingerprint,
        });
        assert(first.change);
        assertEquals(first.key_mapping.prop_2, "prop_3");
        const repeatInput = { ...input, change_id: first.change.id, expected_change_version: first.change.version };
        const repeatReview = await previewEntitySchemaImport(f.deps, f.a.actor, repeatInput);
        assertEquals(repeatReview.key_mapping.prop_2, "prop_3");
        const repeated = await prepareEntitySchemaImport(f.deps, f.actor(), {
          ...repeatInput,
          preview_fingerprint: repeatReview.preview_fingerprint,
        });
        assertEquals(repeated.change?.id, first.change.id);
        assertEquals(repeated.key_mapping.prop_2, "prop_3");
        assertEquals((await getEntityType(f.deps, f.a.actor, type.id)).next_property_number, 4);
        assertEquals((await f.effects()).drafts, before.drafts + 1);
        const draft = await getEntitySchemaChange(f.deps, f.a.actor, type.id, first.change.id);
        assertEquals(Object.keys(draft.target.schema.properties), ["prop_1", "prop_3"]);
        if (scenario === "reserved") assertEquals(draft.target.schema.required, ["prop_1", "prop_3"]);
      } finally {
        await f.cleanup();
      }
    },
  );
}

dbTest(
  "schema import competing reservation makes the reviewed preview stale instead of silently renumbering",
  async () => {
    const f = await fixture();
    try {
      const type = await createEntityType(f.deps, f.actor(), { label: "예약 경쟁" }),
        document = (await getEntitySchema(f.deps, f.a.actor, { type_id: type.id })).schema;
      document.properties.prop_99 = { type: "integer", "x-order": 20 };
      const input = {
          mode: "update",
          type_id: type.id,
          expected_schema_version: 1,
          document: JSON.stringify(document),
        },
        review = await previewEntitySchemaImport(f.deps, f.a.actor, input);
      assertEquals(review.key_mapping.prop_99, "prop_2");
      await createEntitySchemaChange(f.deps, f.actor(), type.id, {
        expected_schema_version: 1,
        edits: [{ op: "add_property", client_ref: "competitor", field: { type: "string", "x-order": 30 } }],
      });
      const before = await f.effects();
      await rejectsCode(
        () =>
          prepareEntitySchemaImport(f.deps, f.actor(), { ...input, preview_fingerprint: review.preview_fingerprint }),
        "schema_plan_stale",
      );
      assertEquals(await f.effects(), before);
      assertEquals((await getEntityType(f.deps, f.a.actor, type.id)).next_property_number, 3);
      const fresh = await previewEntitySchemaImport(f.deps, f.a.actor, input);
      assertEquals(fresh.key_mapping.prop_99, "prop_3");
      const prepared = await prepareEntitySchemaImport(f.deps, f.actor(), {
        ...input,
        preview_fingerprint: fresh.preview_fingerprint,
      });
      assertEquals(prepared.key_mapping.prop_99, "prop_3");
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "maximum 256 KiB schema copy and wholesale import keep complete DB drafts and bounded replay receipts",
  async () => {
    const f = await fixture();
    try {
      const source = initialEntityDefinition("이름", { id: crypto.randomUUID(), title: "최대 문서" }).schema;
      for (let n = 2; n <= 64; n++) {
        source.properties[`prop_${n}`] = {
          type: "string",
          "x-order": n * 10,
          oneOf: Array.from(
            { length: 4 },
            (_, i) => ({ const: String(i).padStart(3, "0") + "a".repeat(900), title: "옵션" }),
          ),
        };
      }
      const bytes = () => new TextEncoder().encode(jsonbText(source)).byteLength;
      for (const option of Object.values(source.properties).flatMap((field) => field.oneOf ?? [])) {
        option.const += "a".repeat(Math.min(4096 - option.const!.length, 262144 - bytes()));
        if (bytes() === 262144) break;
      }
      assertEquals(bytes(), 262144);
      const copy = { mode: "copy", document: JSON.stringify(source, null, 2) },
        copyReview = await previewEntitySchemaImport(f.deps, f.a.actor, copy);
      const copied = await prepareEntitySchemaImport(f.deps, f.actor(), {
        ...copy,
        preview_fingerprint: copyReview.preview_fingerprint,
      });
      assert(copied.type);
      const imported = (await getEntitySchema(f.deps, f.a.actor, { type_id: copied.type.id })).schema;
      for (const field of Object.values(imported.properties)) {
        for (const option of field.oneOf ?? []) {
          option.const = option.const!.replaceAll("a", "b");
        }
      }
      const input = {
          mode: "update",
          type_id: copied.type.id,
          expected_schema_version: 1,
          document: JSON.stringify(imported, null, 2),
        },
        review = await previewEntitySchemaImport(f.deps, f.a.actor, input),
        actor = f.actor();
      const prepared = await prepareEntitySchemaImport(f.deps, actor, {
        ...input,
        preview_fingerprint: review.preview_fingerprint,
      });
      assert(prepared.change);
      const draft = await getEntitySchemaChange(f.deps, f.a.actor, copied.type.id, prepared.change.id);
      assertEquals(draft.target.schema.properties, imported.properties);
      assertEquals(prepared.schema, undefined);
      assertEquals((await getEntityType(f.deps, f.a.actor, copied.type.id)).next_property_number, 65);
      const [sizes] = await f
        .admin`select octet_length(c.schema::text)::int as published_bytes,octet_length((d.target->'schema')::text)::int as draft_bytes,octet_length(r.result::text)::int as receipt_bytes from app.entity_schema_versions c join app.entity_schema_changes d on d.type_id=c.type_id and d.owner_id=c.owner_id join private.request_results r on r.owner_id=c.owner_id and r.request_key=${
        actor.request!.key
      } where c.type_id=${copied.type.id}`;
      assertEquals(sizes.published_bytes, 262144);
      assertEquals(sizes.draft_bytes, 262144);
      assert(sizes.receipt_bytes < 16384);
      const beforeExpandedLabel = await f.effects();
      const original = await getEntitySchema(f.deps, f.a.actor, { type_id: copied.type.id });
      await rejectsCode(() =>
        updateEntityType(f.deps, f.actor(), copied.type!.id, {
          expected_schema_version: 1,
          label: "최대 문서 이름 증가",
        }), "invalid_input");
      assertEquals(await f.effects(), beforeExpandedLabel);
      assertEquals((await getEntitySchema(f.deps, f.a.actor, { type_id: copied.type.id })).schema, original.schema);
      // Same-width metadata changes fit through version 9. The server-assigned 10
      // must be counted before any new draft, key reservation or receipt commits.
      for (let version = 2; version <= 9; version++) {
        const updated = await updateEntityType(f.deps, f.actor(), copied.type.id, {
          expected_schema_version: version - 1,
          label: version % 2 === 0 ? "최대 문사" : "최대 문서",
        });
        assertEquals(updated.schema_version, version);
      }
      const head = await getEntitySchema(f.deps, f.a.actor, { type_id: copied.type.id });
      assertEquals(head.schema["x-version"], 9);
      const beforeVersionGrowth = await f.effects();
      await rejectsCode(() =>
        createEntitySchemaChange(f.deps, f.actor(), copied.type!.id, {
          expected_schema_version: 9,
          edits: [{
            op: "update_property",
            key: "prop_1",
            field: { ...head.schema.properties.prop_1, title: "코드" },
            required: true,
          }],
        }), "invalid_input");
      assertEquals(await f.effects(), beforeVersionGrowth);
      assertEquals((await getEntitySchema(f.deps, f.a.actor, { type_id: copied.type.id })).schema, head.schema);
      assertEquals((await getEntityType(f.deps, f.a.actor, copied.type.id)).next_property_number, 65);
    } finally {
      await f.cleanup();
    }
  },
);
