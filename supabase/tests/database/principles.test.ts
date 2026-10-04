import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import {
  principleCreate,
  principleListQuery,
  principleResult,
  principleSave,
  principleUpdate,
} from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 4, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) };
const content = { title: "기준", summary: "판단 근거", body: "첫 본문" };
dbTest(
  "current principle: first/concurrent/idempotent save, one current, history ordering and scoped cursor",
  async () => {
    const f = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const a = f.actor, i = principleCreate.parse({ ...content, request_id: crypto.randomUUID() });
      const [first, retry] = await Promise.all([p.createPrinciple(d, a, i), p.createPrinciple(d, a, i)]);
      assertEquals(first.id, retry.id);
      principleResult.parse(first);
      await assertRejects(() => p.createPrinciple(d, a, principleCreate.parse(content)), AppError);
      await assertRejects(() =>
        p.saveCurrentPrinciple(
          d,
          a,
          principleSave.parse({ ...content, body: "missing reason", expected_version: first.version }),
        ), AppError);
      const nextInput = principleSave.parse({
        ...content,
        body: "두 번째",
        expected_version: first.version,
        change_note: "기준 갱신",
        request_id: crypto.randomUUID(),
      });
      const [next, dup] = await Promise.all([
        p.saveCurrentPrinciple(d, a, nextInput),
        p.saveCurrentPrinciple(d, a, nextInput),
      ]);
      assertEquals(next.id, dup.id);
      assert(next.id !== first.id);
      assertEquals(next.version, first.version + 1);
      const races = await Promise.allSettled(["세 번째 A", "세 번째 B"].map((body) =>
        p.saveCurrentPrinciple(
          d,
          a,
          principleSave.parse({ ...content, body, expected_version: next.version, change_note: "동시 편집" }),
        )
      ));
      assertEquals(
        races.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assertEquals(
        (await admin`select count(*)::int n from app.principles where owner_id=${a.userId} and is_current`)[0].n,
        1,
      );
      assertEquals(
        (await admin`select count(*)::int n from app.records where owner_id=${a.userId} and record_kind='change'`)[0].n,
        3,
      );
      const all = await p.listPrinciples(d, a, principleListQuery.parse({ view: "all", limit: 1 }));
      assert(all.next_cursor);
      assertEquals(
        (await p.listPrinciples(d, a, principleListQuery.parse({ view: "all", limit: 1, cursor: all.next_cursor })))
          .items[0].id,
        next.id,
      );
      await assertRejects(
        () => p.listPrinciples(d, b.actor, principleListQuery.parse({ view: "all", cursor: all.next_cursor })),
        AppError,
      );
      await assertRejects(
        () => p.listPrinciples(d, a, principleListQuery.parse({ view: "history", cursor: all.next_cursor })),
        AppError,
      );
      await assertRejects(() => p.getPrinciple(d, b.actor, first.id), AppError);
      assertEquals(
        (await asUser(sql, b.actor.userId, (tx) => tx`select id from app.principles where id=${first.id}`)).length,
        0,
      );
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx`set local role authenticated`;
          return tx`select * from app.principles`;
        })),
        /^42501/,
      );
    } finally {
      await f.cleanup();
      await b.cleanup();
    }
  },
);
dbTest(
  "current principle: no-op, history correction keeps saved_at, current delete promotes prior, last delete empty",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const a = f.actor, first = await p.createPrinciple(d, a, principleCreate.parse(content));
      const noop = await p.saveCurrentPrinciple(
        d,
        a,
        principleSave.parse({ ...content, expected_version: first.version, change_note: "동일 값" }),
      );
      assertEquals(noop.id, first.id);
      assertEquals(noop.version, first.version);
      const next = await p.saveCurrentPrinciple(
        d,
        a,
        principleSave.parse({ ...content, body: "두 번째", expected_version: first.version, change_note: "새 기준" }),
      );
      const corrected = await p.correctPrinciple(
        d,
        a,
        first.id,
        principleUpdate.parse({ expected_version: first.version, body: "오타 정정", change_note: "오타" }),
      );
      assertEquals(corrected.saved_at, first.saved_at);
      assertEquals(corrected.is_current, false);
      assertEquals((await p.currentPrinciple(d, a)).current?.id, next.id);
      await assertRejects(() =>
        p.correctPrinciple(
          d,
          a,
          next.id,
          principleUpdate.parse({ expected_version: next.version, body: "안 됨", change_note: "오류" }),
        ), AppError);
      await assertRejects(() => p.deletePrinciple(d, a, first.id, first.version), AppError);
      await p.deletePrinciple(d, a, next.id, next.version, "삭제", crypto.randomUUID());
      assertEquals((await p.currentPrinciple(d, a)).current?.id, first.id);
      const current = (await p.currentPrinciple(d, a)).current!;
      assertEquals(current.body, corrected.body);
      assertEquals(current.saved_at, first.saved_at);
      assert(current.version > corrected.version && current.version > next.version);
      const beforeDenied = (await admin`select count(*)::int n from app.records where owner_id=${a.userId}`)[0].n;
      await assertRejects(
        () =>
          p.saveCurrentPrinciple(
            d,
            a,
            principleSave.parse({
              ...content,
              body: "stale before promotion",
              expected_version: corrected.version,
              change_note: "거부",
            }),
          ),
        AppError,
      );
      assertEquals(
        (await admin`select count(*)::int n from app.records where owner_id=${a.userId}`)[0].n,
        beforeDenied,
      );
      await p.deletePrinciple(d, a, current.id, current.version);
      assertEquals((await p.currentPrinciple(d, a)).current, null);
      assertEquals((await admin`select count(*)::int n from app.records where owner_id=${a.userId}`)[0].n, 5);
      const recreated = await p.createPrinciple(d, a, principleCreate.parse(content));
      assert(recreated.version > current.version);
      await assertRejects(
        () =>
          p.saveCurrentPrinciple(
            d,
            a,
            principleSave.parse({
              ...content,
              body: "stale before recreation",
              expected_version: first.version,
              change_note: "거부",
            }),
          ),
        AppError,
      );
      assertEquals((await p.currentPrinciple(d, a)).current?.id, recreated.id);
      assertEquals((await admin`select count(*)::int n from app.records where owner_id=${a.userId}`)[0].n, 6);
    } finally {
      await f.cleanup();
    }
  },
);
