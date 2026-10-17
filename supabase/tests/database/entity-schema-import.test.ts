import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { replayEntitySchemaImport } from "../../functions/_shared/core/entity-types/schema-import.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

// New copy/update guarantees live at the whole-model boundary in data-model.test.ts.
// This removed entry point only reads an exact, already completed historical receipt.
dbTest(
  "retired single-kind import preserves exact completed receipts, owner scope and expiry without new writes",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct);
    const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const deps = { uow: new SqlEntityTypeUnitOfWork(sql) }, actor = requestActor(a.actor);
      const raw = { mode: "copy", document: "{}", preview_fingerprint: "b".repeat(64), new_keys: [], remove_keys: [] };
      const identity = await requestIdentity(actor, "entity-schema-import.prepare", null, raw);
      const original = {
        mode: "copy" as const,
        changed: true,
        source_type_id: crypto.randomUUID(),
        source_schema_version: 9,
        current_schema_version: null,
        source_is_stale: false,
        metadata_preserved: false,
        key_mapping: { prop_9: "prop_1" },
        removed_keys: [],
        preview_fingerprint: raw.preview_fingerprint,
        change: null,
      };
      await asUser(sql, a.actor.userId, async (tx) => {
        await tx`select app.begin_request(${identity.key}::uuid,${identity.operation},${identity.fingerprint})`;
        await tx`select app.finish_request(${identity.key}::uuid,${tx.json(original)})`;
      });
      assertEquals(await replayEntitySchemaImport(deps, actor, raw), original);
      assertEquals(await replayEntitySchemaImport(deps, actor, raw), original);
      const changed = await assertRejects(
        () => replayEntitySchemaImport(deps, actor, { ...raw, document: '{"changed":true}' }),
        AppError,
      );
      assertEquals(changed.code, "idempotency_key_reused");
      await assertRejects(
        () => replayEntitySchemaImport(deps, { ...b.actor, request: actor.request }, raw),
        AppError,
        "전체 자료 모델",
      );
      await assertRejects(() => replayEntitySchemaImport(deps, requestActor(a.actor), raw), AppError, "전체 자료 모델");
      await admin`update private.request_results set completed_at=now()-interval '31 days' where owner_id=${a.actor.userId} and request_key=${identity.key}::uuid`;
      assertEquals(
        (await assertRejects(() => replayEntitySchemaImport(deps, actor, raw), AppError)).code,
        "result_expired",
      );
    } finally {
      await a.cleanup();
      await b.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
