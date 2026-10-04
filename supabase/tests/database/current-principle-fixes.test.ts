import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { principleCorrection, principleSave } from "../../functions/_shared/contracts/principle.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { search } from "../../functions/_shared/core/search/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const pd = { uow: new SqlPrincipleUnitOfWork(sql) },
  sd = { uow: new SqlSearchUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "deleted applied principle: omitted/unchanged snapshots survive; explicit clear rolls back, retries once, then no-op",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const old = await p.saveCurrentPrinciple(
        pd,
        f.actor,
        principleSave.parse({ title: "old", summary: "context", body: "original" }),
      );
      let record = await a.createRecord(
        ad,
        f.actor,
        recordCreate.parse({ title: "decision", summary: "context", applied_principle_ids: [old.id] }),
      );
      const snapshots = record.applied_principle_snapshots;
      await p.saveCurrentPrinciple(
        pd,
        f.actor,
        principleSave.parse({
          title: "current",
          summary: "context",
          expected_version: old.version,
          change_note: "new policy",
        }),
      );
      await p.correctPrinciple(
        pd,
        f.actor,
        old.id,
        principleCorrection.parse({ expected_version: old.version, body: "corrected", change_note: "correction" }),
      );
      record = await a.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({
          expected_version: record.version,
          title: "decision updated",
          applied_principle_ids: [old.id],
          change_note: "same selection",
        }),
      );
      assertEquals(record.applied_principle_snapshots, snapshots);
      const source = await p.getPrinciple(pd, f.actor, old.id);
      await p.deletePrinciple(pd, f.actor, old.id, source.version);
      record = await a.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({ expected_version: record.version, body: "detail", change_note: "omitted selection" }),
      );
      assertEquals(record.applied_principle_ids, []);
      assertEquals(record.applied_principle_snapshots, snapshots);
      const count = async () =>
        (await admin`select count(*)::int n from app.records where owner_id=${f.actor.userId} and change_metadata->>'target_id'=${record.id}`)[
          0
        ].n;
      const beforeCount = await count();
      const patch = recordUpdate.parse({
        expected_version: record.version,
        applied_principle_ids: [],
        change_note: "clear historical context",
        request_id: crypto.randomUUID(),
      });
      const bad: a.ActivityDeps = {
        ...ad,
        uow: {
          run: (actor, fn) =>
            ad.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "appendChange"
                      ? () => Promise.reject(Error("required snapshot-clear history failure"))
                      : Reflect.get(target, key),
                }),
              )),
        },
      };
      await assertRejects(() => a.updateRecord(bad, f.actor, record.id, patch));
      assertEquals(await a.getRecord(ad, f.actor, record.id), record);
      assertEquals(await count(), beforeCount);
      assertEquals(
        (await admin`select request_id from app.request_results where owner_id=${f.actor.userId} and request_id=${patch
          .request_id!}`).length,
        0,
      );
      const cleared = await a.updateRecord(ad, f.actor, record.id, patch);
      assertEquals(cleared.version, record.version + 1);
      assertEquals(cleared.applied_principle_snapshots, []);
      assertEquals(await a.updateRecord(ad, f.actor, record.id, patch), cleared);
      assertEquals(
        await a.updateRecord(
          ad,
          f.actor,
          record.id,
          recordUpdate.parse({ ...patch, expected_version: cleared.version, request_id: undefined }),
        ),
        cleared,
      );
      assertEquals(await count(), beforeCount + 1);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("history memo correction keeps content/order/current and rollback/no-op/index/revision semantics", async () => {
  const f = await fixtureOwner(admin);
  try {
    const old = await p.saveCurrentPrinciple(
      pd,
      f.actor,
      principleSave.parse({ title: "first", summary: "context", body: "original" }),
    );
    const current = await p.saveCurrentPrinciple(
      pd,
      f.actor,
      principleSave.parse({
        title: "second",
        summary: "context",
        expected_version: old.version,
        change_note: "new policy",
      }),
    );
    const queue =
      await admin`select message from pgmq.q_search_index where message->>'kind'='principle' and message->>'owner_id'=${f.actor.userId} order by msg_id`;
    const patch = principleCorrection.parse({
      expected_version: old.version,
      change_note: "reason corrected",
      request_id: crypto.randomUUID(),
    });
    const bad: p.PrincipleDeps = {
      uow: {
        run: (actor, fn) =>
          pd.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange"
                    ? () => Promise.reject(Error("required memo history failure"))
                    : Reflect.get(target, key),
              }),
            )),
      },
    };
    await assertRejects(() => p.correctPrinciple(bad, f.actor, old.id, patch));
    assertEquals((await p.getPrinciple(pd, f.actor, old.id)).change_note, old.change_note);
    const corrected = await p.correctPrinciple(pd, f.actor, old.id, patch);
    assertEquals([corrected.title, corrected.summary, corrected.body, corrected.saved_at, corrected.is_current], [
      old.title,
      old.summary,
      old.body,
      old.saved_at,
      false,
    ]);
    assertEquals(corrected.change_note, patch.change_note);
    assertEquals(corrected.version, old.version + 1);
    assertEquals((await p.currentPrinciple(pd, f.actor)).current, current);
    assertEquals(await p.correctPrinciple(pd, f.actor, old.id, patch), corrected);
    assertEquals(
      await p.correctPrinciple(
        pd,
        f.actor,
        old.id,
        principleCorrection.parse({ expected_version: corrected.version, change_note: patch.change_note }),
      ),
      corrected,
    );
    assertEquals(
      await admin`select message from pgmq.q_search_index where message->>'kind'='principle' and message->>'owner_id'=${f.actor.userId} order by msg_id`,
      queue,
    );
    assertEquals(
      (await admin`select id from app.records where owner_id=${f.actor.userId} and change_metadata->>'target_id'=${old.id} and change_metadata->>'action'='update'`)
        .length,
      1,
    );
    const next = await p.saveCurrentPrinciple(
      pd,
      f.actor,
      principleSave.parse({
        title: "third",
        summary: "context",
        expected_version: current.version,
        change_note: "next",
      }),
    );
    assert(next.version > Math.max(current.version, corrected.version));
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "explicit view beats every legacy status for candidates/coverage/anchor/cursor; absent-only aliases share cursors",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      let version: number | undefined;
      const ids: string[] = [];
      for (let n = 0; n < 3; n++) {
        const row = await p.saveCurrentPrinciple(
          pd,
          f.actor,
          principleSave.parse({
            title: `policy ${n}`,
            summary: "context",
            ...(version ? { expected_version: version, change_note: "next" } : {}),
          }),
        );
        ids.unshift(row.id);
        version = row.version;
      }
      for (const view of ["current", "history", "all"] as const) {
        const expected = view === "current" ? ids.slice(0, 1) : view === "history" ? ids.slice(1) : ids;
        const base = {
          query: "policy",
          kinds: ["principle"],
          mode: "keyword",
          principle_view: view,
          limit: 1,
          anchor: { kind: "principle", id: ids[2] },
        };
        const reference = await search(sd, f.actor, searchInput.parse(base));
        for (const status of ["active", "inactive", "all"] as const) {
          const result = await search(sd, f.actor, searchInput.parse({ ...base, status }));
          assertEquals(result, reference);
          assertEquals(result.semantic_coverage, { pending: expected.length, excluded: 0 });
          assertEquals(result.anchor_page, view === "current" ? null : expected.length);
          const collected = result.items.map((i) => i.id);
          let cursor = result.next_cursor;
          while (cursor) {
            const page = await search(sd, f.actor, searchInput.parse({ ...base, status, cursor }));
            collected.push(...page.items.map((i) => i.id));
            cursor = page.next_cursor;
          }
          assertEquals(collected, expected);
        }
        const legacy = ({ current: "active", history: "inactive", all: "all" } as const)[view];
        assertEquals(
          await search(sd, f.actor, searchInput.parse({ ...base, principle_view: undefined, status: legacy })),
          reference,
        );
        if (reference.next_cursor) {
          assertEquals(
            await search(
              sd,
              f.actor,
              searchInput.parse({ ...base, principle_view: undefined, status: legacy, cursor: reference.next_cursor }),
            ),
            await search(sd, f.actor, searchInput.parse({ ...base, cursor: reference.next_cursor })),
          );
          await assertRejects(() =>
            search(
              sd,
              f.actor,
              searchInput.parse({ ...base, principle_view: "current", cursor: reference.next_cursor }),
            )
          );
        }
      }
    } finally {
      await f.cleanup();
    }
  },
);
