// 사용자 격리·직접 쓰기 차단·연결 재사용 시 문맥 해제·원본과 큐의 원자성(실제 로컬 DB).
import { assert, assertEquals, assertMatch } from "@std/assert";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { asUser, connect, dbTest, devUsers, fixtureOwner, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const { a: A, b: B } = await devUsers(admin);

const insertTask = (owner: string, title = "격리 시험") => (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
  tx<{ id: string }[]>`
    insert into app.tasks (owner_id, kind, title, body, status)
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

  dbTest(`${name}: 현재 색인 등록 경로로 원본·상태·큐는 함께 롤백·커밋된다`, async () => {
    const sql = connect(url, { max: 1, ...opts });
    const fixture = await fixtureOwner(admin), owner = fixture.actor.userId;
    const body = "현재 색인 등록 원문", hash = await searchInputHash(body);
    const count = async () => {
      const [r] = await admin<{ records: number; states: number; msgs: number }[]>`
        select (select count(*)::int from app.records where owner_id=${owner}) as records,
          (select count(*)::int from app.search_index_state where owner_id=${owner}) as states,
          (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${owner}) as msgs`;
      return r;
    };
    const insertAndEnqueue = async (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => {
      const [{ id }] = await tx<{ id: string }[]>`
        insert into app.records(owner_id,body) values(${owner},${body}) returning id`;
      await tx`select app.enqueue_search_index('record',${id},${hash},${SEARCH_PIPELINE})`;
    };
    try {
      assertEquals(await count(), { records: 0, states: 0, msgs: 0 });
      const failed = await outcome(asUser(sql, owner, async (tx) => {
        await insertAndEnqueue(tx);
        throw new Error("색인 등록 뒤 실패");
      }));
      assertMatch(failed, /색인 등록 뒤 실패/);
      assertEquals(await count(), { records: 0, states: 0, msgs: 0 });

      await asUser(sql, owner, insertAndEnqueue);
      assertEquals(await count(), { records: 1, states: 1, msgs: 1 });
      const [job] = await admin`
        select s.id,s.input_hash,s.pipeline,m.message from app.search_index_state s
        join pgmq.q_search_index m on m.msg_id=s.message_id where s.owner_id=${owner}`;
      assertEquals(job.input_hash, hash);
      assertEquals(job.pipeline, SEARCH_PIPELINE);
      assertEquals(job.message, {
        owner_id: owner,
        kind: "record",
        id: job.id,
        input_hash: hash,
        pipeline: SEARCH_PIPELINE,
      });
    } finally {
      await fixture.cleanup();
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
      await tx`insert into app.tasks (owner_id, kind, title, body, status) values (${A}, 'once', 'x', 'y', 'open')`;
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

dbTest("접속·사용자 역할의 직접 큐 전송·테이블 접근은 거부된다", async () => {
  const fixture = await fixtureOwner(admin);
  const message = JSON.stringify({ owner_id: fixture.actor.userId });
  try {
    for (const role of ["app_server", "app_user"]) {
      const [{ allowed }] = await admin`select has_schema_privilege(${role},'pgmq','USAGE') as allowed`;
      assertEquals(allowed, false, role);
      for (
        const query of [
          "select pgmq.send('search_index',$1::jsonb)",
          "select pgmq.send('search_index',$1::jsonb,'{}'::jsonb,now())",
          "insert into pgmq.q_search_index(message) values($1::jsonb)",
          "select msg_id from pgmq.q_search_index limit 1",
          "select pgmq.format_table_name('q','search_index')",
        ]
      ) {
        const result = await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          return tx.unsafe(query, query.includes("$1") ? [message] : []);
        }));
        assertMatch(result, /^42501 permission denied/, `${role}: ${query}`);
      }
    }
  } finally {
    await fixture.cleanup();
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
      insert into app.records (owner_id, body, task_id) values (${B}, '기록', ${id})`));
    assertMatch(r, /^23503 /);
  } finally {
    await sql.end();
  }
});
