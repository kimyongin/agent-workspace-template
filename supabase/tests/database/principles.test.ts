import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { principleCreate, principleResult, principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import * as p from "../../functions/_shared/core/principles/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 4, prepare: false }),
  d = { uow: new SqlPrincipleUnitOfWork(sql) };
const content = { title: "기준", body: "첫 본문" };
dbTest(
  "current principle: first/concurrent/idempotent save, same document, owner isolation and retired history rejection",
  async () => {
    const f = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const a = f.actor, i = principleCreate.parse({ ...{ ...content } });
      const creations = await Promise.allSettled([
        p.createPrinciple(d, requestActor(a), i),
        p.createPrinciple(d, requestActor(a), i),
      ]);
      assertEquals(creations.filter((r) => r.status === "fulfilled").length, 1);
      const first = (creations.find((r) =>
        r.status === "fulfilled"
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof p.createPrinciple>>>).value;
      principleResult.parse(first);
      await assertRejects(() =>
        p.createPrinciple(d, requestActor(a), principleCreate.parse({ ...content })), AppError);
      const nextInput = principleUpdate.parse({
        ...content,
        body: "두 번째",
        expected_version: first.version,
        change_note: "기준 갱신",
      });
      const next = await p.updatePrinciple(d, requestActor(a), first.id, nextInput);
      await assertRejects(() => p.updatePrinciple(d, requestActor(a), first.id, nextInput), AppError);
      assertEquals(next.id, first.id);
      assertEquals(next.version, first.version + 1);
      const races = await Promise.allSettled(["세 번째 A", "세 번째 B"].map((body) =>
        p.updatePrinciple(
          d,
          requestActor(a),
          first.id,
          principleUpdate.parse({ ...content, body, expected_version: next.version, change_note: "동시 편집" }),
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
        await admin`insert into app.principles(owner_id,title,body,is_current,origin,saved_at) values(${a.userId},'과거 자료','과거 원문',false,'legacy','2020-01-01T00:00:00Z') returning id`;
      await assertRejects(() => p.getPrinciple(d, a, legacy.id), AppError);
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
  "current principle: no-op ignores memo-only changes; archive stays read-only; deletion never promotes history",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const a = f.actor;
      const [legacy] = await admin`insert into app.principles(owner_id,title,body,is_current,origin,saved_at)
      values(${a.userId},'과거 자료','과거 원문',false,'legacy','2020-01-01T00:00:00Z') returning id`;
      const before = (await admin`select * from app.principles where id=${legacy.id}`)[0];
      const first = await p.createPrinciple(d, requestActor(a), principleCreate.parse({ ...content }));
      const noop = await p.updatePrinciple(
        d,
        requestActor(a),
        first.id,
        principleUpdate.parse({
          ...content,
          expected_version: first.version,
          change_note: "새 메모",
        }),
      );
      assertEquals(noop, first);
      const logs = () => admin`select count(*)::int n from app.records where owner_id=${a.userId}`;
      assertEquals((await logs())[0].n, 1);
      const next = await p.updatePrinciple(
        d,
        requestActor(a),
        first.id,
        principleUpdate.parse({
          ...content,
          body: "두 번째",
          expected_version: first.version,
          change_note: "사용자가 편집한 근거",
        }),
      );
      assertEquals(next.id, first.id);
      const record =
        (await admin`select body from app.records where owner_id=${a.userId} and body='사용자가 편집한 근거'`)[0];
      assertEquals(record, { body: "사용자가 편집한 근거" });
      await assertRejects(() => p.getPrinciple(d, a, legacy.id), AppError);
      await assertRejects(() => p.deletePrinciple(d, requestActor(a), legacy.id, before.version), AppError);
      assertEquals((await admin`select * from app.principles where id=${legacy.id}`)[0], before);
      await p.deletePrinciple(d, requestActor(a), next.id, next.version, "삭제 메모");
      assertEquals((await p.currentPrinciple(d, a)).current, null);
      assertEquals((await admin`select * from app.principles where id=${legacy.id}`)[0], before);
      const count = (await logs())[0].n;
      await assertRejects(
        () =>
          p.updatePrinciple(
            d,
            requestActor(a),
            first.id,
            principleUpdate.parse({ ...content, expected_version: next.version }),
          ),
        AppError,
      );
      assertEquals((await logs())[0].n, count);
      const recreated = await p.createPrinciple(d, requestActor(a), principleCreate.parse({ ...content }));
      assert(recreated.id !== first.id);
      assertEquals(recreated.version, 1);
      await assertRejects(
        () =>
          p.updatePrinciple(
            d,
            requestActor(a),
            first.id,
            principleUpdate.parse({ ...content, body: "오래된 변경", expected_version: first.version }),
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

dbTest("current principle concurrent patches keep omitted content and reject the stale loser", async () => {
  const f = await fixtureOwner(admin);
  try {
    const first = await p.createPrinciple(d, requestActor(f.actor), principleCreate.parse({ ...content }));
    const patches = await Promise.allSettled(
      ["수정 A", "수정 B"].map((title) =>
        p.updatePrinciple(d, requestActor(f.actor), first.id, { title, expected_version: first.version })
      ),
    );
    const winners = patches.filter((r) => r.status === "fulfilled");
    assertEquals(winners.length, 1);
    const loser = patches.find((r) => r.status === "rejected");
    assert(loser?.status === "rejected" && loser.reason instanceof AppError);
    assertEquals(loser.reason.code, "conflict");
    const current = (await p.currentPrinciple(d, f.actor)).current!;
    assertEquals([current.id, current.body, current.version], [
      first.id,
      content.body,
      2,
    ]);
    assertEquals(winners[0].status === "fulfilled" && winners[0].value, current);
  } finally {
    await f.cleanup();
  }
});
