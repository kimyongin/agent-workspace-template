import { assertEquals, assertThrows } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { principleCreate, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import * as r from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) },
  rd = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "applied principle snapshot survives current policy update/deletion; readonly archived captures stay exact",
  async () => {
    const f = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const a = f.actor, content = { title: "당시 기준", body: "그때 본문" };
      const first = await p.createPrinciple(d, a, principleCreate.parse({ id: crypto.randomUUID(), ...content }));
      const record = await r.createRecord(
        rd,
        a,
        recordCreate.parse({ id: crypto.randomUUID(), ...{ body: "판단" } }),
      );
      const snapshot = [{
        id: first.id,
        ...content,
        summary: "당시 요약",
        version: first.version,
        saved_at: first.saved_at,
        status: "active",
        captured_at: "application",
      }];
      // Historical rows are seeded administratively; public writers can no longer capture links.
      await admin`update app.records set applied_principle_snapshots=${admin.json(snapshot)} where id=${record.id}`;
      assertEquals(
        recordCreate.safeParse({
          id: crypto.randomUUID(),
          ...{ title: "새", applied_principle_ids: [first.id] },
        }).success,
        false,
      );
      const current = await p.updatePrinciple(
        d,
        a,
        first.id,
        principleUpdate.parse({ ...content, body: "새 기준", change_note: "갱신", expected_version: first.version }),
      );
      assertEquals(current.id, first.id);
      assertEquals(current.body, "새 기준");
      assertEquals(current.version, first.version + 1);
      assertEquals((await r.getRecord(rd, a, record.id)).applied_principle_snapshots, snapshot);
      const edited = await r.updateRecord(
        rd,
        a,
        record.id,
        recordUpdate.parse({
          expected_version: record.version,
          body: "판단 이유 정정",
        }),
      );
      assertEquals(edited.applied_principle_snapshots, snapshot);
      await p.deletePrinciple(d, a, current.id, current.version);
      assertEquals((await p.currentPrinciple(d, a)).current, null);
      const after = await r.getRecord(rd, a, record.id);
      assertEquals(after.applied_principle_snapshots, snapshot);
      assertEquals("applied_principle_ids" in after, false);
      assertEquals(after.version, edited.version);
      const foreign = await p.createPrinciple(
        d,
        b.actor,
        principleCreate.parse({ id: crypto.randomUUID(), ...content }),
      );
      assertThrows(() =>
        recordUpdate.parse({
          expected_version: edited.version,
          applied_principle_ids: [foreign.id],
        })
      );
      assertEquals((await r.getRecord(rd, a, record.id)).applied_principle_snapshots, snapshot);
    } finally {
      await f.cleanup();
      await b.cleanup();
    }
  },
);
