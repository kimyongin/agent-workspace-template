import { assertEquals, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { principleCreate, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) };
dbTest(
  "principle change-record failure rolls back same current document/queue/request; same retry succeeds",
  async () => {
    const f = await fixtureOwner(admin);
    const a = f.actor;
    try {
      const first = await p.createPrinciple(
        d,
        a,
        principleCreate.parse({ id: crypto.randomUUID(), ...{ title: "기준" } }),
      );
      const i = principleUpdate.parse({
        title: "새 기준",
        body: "본문",
        change_note: "원자성",
        expected_version: first.version,
      });
      const broken = {
        uow: {
          run: <T>(actor: typeof a, fn: Parameters<typeof d.uow.run<T>>[1]) =>
            d.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "appendChange" ? () => Promise.reject(Error("record failure")) : Reflect.get(target, key),
                }),
              )),
        },
      };
      await assertRejects(() => p.updatePrinciple(broken, a, first.id, i));
      assertEquals((await p.currentPrinciple(d, a)).current?.id, first.id);
      assertEquals((await p.currentPrinciple(d, a)).current, first);
      assertEquals((await admin`select id from app.principles where owner_id=${a.userId}`).length, 1);
      // The failed save leaves only the creation change record indexed. Latest principles never enqueue embeddings.
      const indexed = () => admin`select kind from app.search_index_state where owner_id=${a.userId}`;
      assertEquals((await indexed()).map((row) => row.kind), ["record"]);
      const result = await p.updatePrinciple(d, a, first.id, i);
      assertEquals(result.id, first.id);
      assertEquals(result.version, 2);
      assertEquals((await indexed()).map((row) => row.kind), ["record", "record"]);
      assertEquals(
        (await admin`select msg_id from pgmq.q_search_index where message->>'owner_id'=${a.userId} and message->>'kind'='principle'`)
          .length,
        0,
      );
      await assertRejects(() => p.updatePrinciple(d, a, first.id, i));
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("principle deletion failure rolls back its revision and the same retry recreates at version one", async () => {
  const f = await fixtureOwner(admin);
  try {
    const first = await p.createPrinciple(
      d,
      f.actor,
      principleCreate.parse({ id: crypto.randomUUID(), ...{ title: "기준" } }),
    );
    const next = await p.updatePrinciple(d, f.actor, first.id, { title: "갱신 기준", expected_version: first.version });
    const broken = {
      uow: {
        run: <T>(actor: typeof f.actor, fn: Parameters<typeof d.uow.run<T>>[1]) =>
          d.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange" ? () => Promise.reject(Error("record failure")) : Reflect.get(target, key),
              }),
            )),
      },
    };
    await assertRejects(() => p.deletePrinciple(broken, f.actor, next.id, next.version, "삭제"));
    assertEquals((await p.currentPrinciple(d, f.actor)).current, next);
    await p.deletePrinciple(d, f.actor, next.id, next.version, "삭제");
    await assertRejects(() => p.deletePrinciple(d, f.actor, next.id, next.version, "삭제"));
    assertEquals((await p.currentPrinciple(d, f.actor)).current, null);
    const replacement = await p.createPrinciple(
      d,
      f.actor,
      principleCreate.parse({ id: crypto.randomUUID(), ...{ title: "새 기준" } }),
    );
    assertEquals(replacement.version, 1);
  } finally {
    await f.cleanup();
  }
});
