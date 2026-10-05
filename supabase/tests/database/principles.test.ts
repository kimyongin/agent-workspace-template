import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import {
  principleCorrection,
  principleCreate,
  principleListQuery,
  principleResult,
  principleSave,
} from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 4, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) };
const content = { title: "기준", summary: "판단 근거", body: "첫 본문" };
dbTest(
  "current principle: first/concurrent/idempotent save, same document, owner isolation and legacy cursor",
  async () => {
    const f = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const a = f.actor, i = principleCreate.parse({ ...content, request_id: crypto.randomUUID() });
      const [first, retry] = await Promise.all([p.createPrinciple(d, a, i), p.createPrinciple(d, a, i)]);
      assertEquals(first.id, retry.id);
      principleResult.parse(first);
      await assertRejects(() => p.createPrinciple(d, a, principleCreate.parse(content)), AppError);
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
      assertEquals(next.id, first.id);
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
      const [legacy] =
        await admin`insert into app.principles(owner_id,title,summary,body,is_current,origin,saved_at) values(${a.userId},'과거 자료','보존 요약','과거 원문',false,'legacy','2020-01-01T00:00:00Z') returning id`;
      const all = await p.listPrinciples(d, a, principleListQuery.parse({ view: "all", limit: 1 }));
      assert(all.next_cursor);
      assertEquals(
        (await p.listPrinciples(d, a, principleListQuery.parse({ view: "all", limit: 1, cursor: all.next_cursor })))
          .items[0].id,
        legacy.id,
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
  "current principle: no-op ignores memo-only changes; legacy correction remains isolated; deletion never promotes history",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const a = f.actor;
      const [legacy] = await admin`insert into app.principles(owner_id,title,summary,body,is_current,origin,saved_at)
      values(${a.userId},'과거 자료','보존 요약','과거 원문',false,'legacy','2020-01-01T00:00:00Z') returning id`;
      const before = await p.getPrinciple(d, a, legacy.id);
      const first = await p.createPrinciple(d, a, principleCreate.parse(content));
      const noop = await p.saveCurrentPrinciple(
        d,
        a,
        principleSave.parse({
          ...content,
          expected_version: first.version,
          change_note: "동일 값",
          change_memo: { title: "메모만 변경", summary: "새 설명", body: "새 메모" },
        }),
      );
      assertEquals(noop, first);
      const logs = () => admin`select count(*)::int n from app.records where owner_id=${a.userId}`;
      assertEquals((await logs())[0].n, 1);
      const next = await p.saveCurrentPrinciple(
        d,
        a,
        principleSave.parse({
          ...content,
          body: "두 번째",
          expected_version: first.version,
          change_memo: { title: "확인한 기록", summary: "최종 요약", body: "사용자가 편집한 근거" },
        }),
      );
      assertEquals(next.id, first.id);
      const record =
        (await admin`select title,summary,body from app.records where owner_id=${a.userId} and title='확인한 기록'`)[0];
      assertEquals(record, { title: "확인한 기록", summary: "최종 요약", body: "사용자가 편집한 근거" });
      const corrected = await p.correctPrinciple(
        d,
        a,
        legacy.id,
        principleCorrection.parse({
          expected_version: before.version,
          body: "과거 오타 정정",
          change_note: "호환 정정",
        }),
      );
      assertEquals(corrected.saved_at, before.saved_at);
      assertEquals(corrected.is_current, false);
      await assertRejects(
        () =>
          p.correctPrinciple(
            d,
            a,
            next.id,
            principleCorrection.parse({ expected_version: next.version, body: "거부", change_note: "현재 문서" }),
          ),
        AppError,
      );
      await assertRejects(() => p.deletePrinciple(d, a, legacy.id, corrected.version), AppError);
      await p.deletePrinciple(d, a, next.id, next.version, "삭제", crypto.randomUUID(), {
        title: "삭제 근거",
        summary: "최종 확인",
        body: "삭제 메모",
      });
      assertEquals((await p.currentPrinciple(d, a)).current, null);
      assertEquals((await p.getPrinciple(d, a, legacy.id)).is_current, false);
      const count = (await logs())[0].n;
      await assertRejects(
        () => p.saveCurrentPrinciple(d, a, principleSave.parse({ ...content, expected_version: next.version })),
        AppError,
      );
      assertEquals((await logs())[0].n, count);
      const recreated = await p.createPrinciple(d, a, principleCreate.parse(content));
      assert(recreated.id !== first.id);
      assert(recreated.version > next.version);
      await assertRejects(
        () =>
          p.saveCurrentPrinciple(
            d,
            a,
            principleSave.parse({ ...content, body: "오래된 변경", expected_version: first.version }),
          ),
        AppError,
      );
      assertEquals((await p.currentPrinciple(d, a)).current, recreated);
      assertEquals((await logs())[0].n, count + 1);
    } finally {
      await f.cleanup();
    }
  },
);
