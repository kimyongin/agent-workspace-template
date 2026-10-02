// 사용자 격리·직접 쓰기 차단·연결 재사용 시 문맥 해제·원본과 큐의 원자성(실제 로컬 DB).
import { assert, assertEquals, assertMatch } from "@std/assert";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const { a: A, b: B } = await devUsers(admin);

const insertTask = (owner: string, title = "격리 시험") => (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
  tx<{ id: string }[]>`
    insert into app.tasks (owner_id, kind, title, summary, status)
    values (${owner}, 'once', ${title}, '요약', 'open') returning id`;

for (
  const [name, url, opts] of [
    ["직접 연결", urls.direct, {}],
    ["트랜잭션 풀러", urls.pooler, { prepare: false }],
  ] as const
) {
  dbTest(`${name}: 사용자 A/B 격리`, async () => {
    const sql = connect(url, { max: 1, ...opts });
    try {
      const [{ id }] = await asUser(sql, A, insertTask(A));
      // B는 A의 행을 보지도, 바꾸지도, 지우지도 못한다.
      assertEquals((await asUser(sql, B, (tx) => tx`select id from app.tasks where id = ${id}`)).length, 0);
      const upd = await asUser(sql, B, (tx) => tx`update app.tasks set title = '탈취' where id = ${id}`);
      assertEquals(upd.count, 0);
      const del = await asUser(sql, B, (tx) => tx`delete from app.tasks where id = ${id}`);
      assertEquals(del.count, 0);
      // B가 A 소유로 쓰기를 시도하면 RLS가 거부한다.
      assertMatch(await outcome(asUser(sql, B, insertTask(A))), /^42501 .*row-level security/);
      // A는 자기 행을 본다.
      assertEquals((await asUser(sql, A, (tx) => tx`select id from app.tasks where id = ${id}`)).length, 1);
    } finally {
      await sql.end();
    }
  });

  dbTest(`${name}: 커밋·롤백 뒤 같은 연결에 역할·문맥이 남지 않는다`, async () => {
    const sql = connect(url, { max: 1, ...opts });
    try {
      await asUser(sql, A, (tx) => tx`select 1`);
      await outcome(asUser(sql, A, () => Promise.reject(new Error("롤백"))));
      const [ctx] = await sql<{ u: string; c: string }[]>`
        select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
      assertEquals(ctx.u, "app_server");
      assertEquals(ctx.c, "");
      // 문맥 없는 접속 역할은 업무 테이블에 접근하지 못한다.
      assertMatch(await outcome(sql`select count(*) from app.tasks`), /^42501 permission denied for schema app/);
    } finally {
      await sql.end();
    }
  });

  dbTest(`${name}: 원본 저장과 큐 전송은 함께 롤백·커밋된다`, async () => {
    const sql = connect(url, { max: 1, ...opts });
    const count = async () => {
      const [r] = await admin<{ tasks: number; msgs: number }[]>`
        select (select count(*)::int from app.tasks) as tasks, (select count(*)::int from pgmq.q_search_index) as msgs`;
      return r;
    };
    try {
      const before = await count();
      const failed = await outcome(asUser(sql, A, async (tx) => {
        await insertTask(A, "롤백 대상")(tx);
        await tx`reset role`;
        await tx`select pgmq.send('search_index', ${tx.json({ kind: "task" })})`;
        throw new Error("전송 뒤 실패");
      }));
      assertMatch(failed, /전송 뒤 실패/);
      assertEquals(await count(), before);

      await asUser(sql, A, async (tx) => {
        await insertTask(A, "커밋 대상")(tx);
        await tx`reset role`;
        await tx`select pgmq.send('search_index', ${tx.json({ kind: "task" })})`;
      });
      const after = await count();
      assertEquals(after, { tasks: before.tasks + 1, msgs: before.msgs + 1 });
    } finally {
      await sql.end();
    }
  });
}

dbTest("동시 요청(연결 4개, 200건)에서 다른 사용자의 행이 보이지 않는다", async () => {
  const sql = connect(urls.pooler, { max: 4, prepare: false });
  try {
    await asUser(sql, A, insertTask(A, "동시성 A"));
    await asUser(sql, B, insertTask(B, "동시성 B"));
    const leaks = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        const me = i % 2 ? A : B;
        return asUser(sql, me, (tx) =>
          tx<{ n: number }[]>`
          select count(*)::int as n from app.tasks where owner_id <> ${me}`).then(([r]) => r.n);
      }),
    );
    assertEquals(leaks.filter((n) => n > 0).length, 0);
  } finally {
    await sql.end();
  }
});

dbTest("Supabase API 역할(authenticated·anon)과 접속 역할은 업무 테이블·큐에 직접 쓰지 못한다", async () => {
  for (const role of ["authenticated", "anon"]) {
    const r = await outcome(admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      const [{ u }] = await tx<{ u: string }[]>`select current_user as u`;
      assertEquals(u, role); // 역할 전환이 실제로 된 뒤에 시험한다
      await tx`insert into app.tasks (owner_id, kind, title, summary, status) values (${A}, 'once', 'x', 'y', 'open')`;
    }));
    assertMatch(r, /^42501 permission denied for schema app/);
    const q = await outcome(admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select pgmq.send('search_index', '{}'::jsonb)`;
    }));
    assertMatch(q, /^42501 permission denied for (schema|function)/);
  }
  const app = connect(urls.direct, { max: 1 });
  try {
    // 접속 역할은 큐 내용을 읽거나 소비하지 못한다(worker 역할의 몫).
    assertMatch(await outcome(app`select message from pgmq.q_search_index limit 1`), /^42501 permission denied/);
    assertMatch(await outcome(app`select * from pgmq.read('search_index', 30, 1)`), /^42501 permission denied/);
  } finally {
    await app.end();
  }
});

dbTest("접속·사용자 역할에 superuser·BYPASSRLS가 없다", async () => {
  const rows = await admin<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('app_server', 'app_user')`;
  assertEquals(rows.length, 2);
  for (const r of rows) assert(!r.rolsuper && !r.rolbypassrls, r.rolname);
});

dbTest("다른 소유자의 할 일을 기록에 연결할 수 없다(복합 외래 키)", async () => {
  const sql = connect(urls.direct, { max: 1 });
  try {
    const [{ id }] = await asUser(sql, A, insertTask(A, "A의 할 일"));
    const r = await outcome(asUser(sql, B, (tx) =>
      tx`
      insert into app.records (owner_id, title, summary, task_id) values (${B}, '기록', '요약', ${id})`));
    assertMatch(r, /^23503 /);
  } finally {
    await sql.end();
  }
});
