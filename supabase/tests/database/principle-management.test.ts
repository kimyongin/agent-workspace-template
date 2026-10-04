import { assertEquals, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { principleCreate, principleSave } from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) };
dbTest(
  "principle required change-record failure rolls back retired current/new row/queue/request; same retry succeeds",
  async () => {
    const f = await fixtureOwner(admin);
    const a = f.actor;
    try {
      const first = await p.createPrinciple(d, a, principleCreate.parse({ title: "기준", summary: "요약" }));
      const i = principleSave.parse({
        title: "새 기준",
        summary: "새 요약",
        body: "본문",
        change_note: "원자성",
        expected_version: first.version,
        request_id: crypto.randomUUID(),
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
      await assertRejects(() => p.saveCurrentPrinciple(broken, a, i));
      assertEquals((await p.currentPrinciple(d, a)).current?.id, first.id);
      assertEquals((await admin`select id from app.principles where owner_id=${a.userId}`).length, 1);
      assertEquals(
        (await admin`select request_id from app.request_results where owner_id=${a.userId} and request_id=${i
          .request_id!}`).length,
        0,
      );
      assertEquals((await admin`select id from app.search_index_state where owner_id=${a.userId}`).length, 2);
      const result = await p.saveCurrentPrinciple(d, a, i);
      assertEquals(result.version, 2);
      assertEquals((await p.saveCurrentPrinciple(d, a, i)).id, result.id);
    } finally {
      await f.cleanup();
    }
  },
);
