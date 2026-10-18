// Actual local DB: current workspace RLS, pooled context reset and atomic producers.
import type postgres from "postgres";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import type { WorkspaceActor } from "../../functions/_shared/core/workspaces/application.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { asUser, connect, dbTest, outcome, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 });
const taskWrite = { target_kind: "tasks", target_id: "*", access: "write" } as const;
const entry = { mode: "business", requirements: [] } as const;
const inWorkspace = <T>(sql: postgres.Sql, actor: WorkspaceActor, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  runInWorkspace(sql, actor, { ...entry, requirements: [] }, fn);
const insertTask = (workspaceId: string, title = "격리 시험") => (tx: postgres.TransactionSql) =>
  tx<{ id: string }[]>`insert into app.tasks(workspace_id,kind,title,body,status)
    values(${workspaceId},'once',${title},'요약','open') returning id`;

async function fixtureFor(sql: postgres.Sql) {
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    const second = await fixture.addWorkspace("같은 계정의 다른 공간");
    for (const actor of [fixture.manager, fixture.member, second.manager, second.member]) {
      await fixture.grant(actor, [
        ...(actor.userId === fixture.manager.userId
          ? [{ target_kind: "settings", target_id: "*", access: "write" } as const]
          : []),
        taskWrite,
      ]);
    }
    return { ...fixture, second };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

// Constraint/ACL negatives retain PostgreSQL SQLSTATE before adapter translation.
function rawWorkspace<T>(sql: postgres.Sql, actor: WorkspaceActor, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return asUser(sql, actor.userId, async (tx) => {
    await tx`select app.lock_workspace_account()`;
    await tx`select app.lock_workspace(${actor.workspaceId}::uuid,false)`;
    await tx`select set_config('request.workspace_id',${actor.workspaceId},true),
      set_config('request.workspace_lock_mode','business',true)`;
    await tx`select app.authorize_workspace('[]'::jsonb)`;
    await tx`select set_config('request.workspace_requirements','[]',true)`;
    return fn(tx);
  });
}

for (
  const [name, url, opts] of [
    ["직접 연결", urls.direct, {}],
    ["트랜잭션 풀러", urls.pooler, { prepare: false }],
  ] as const
) {
  dbTest(`${name}: 실제 사용자·같은 사용자 다른 공간의 RLS 격리`, async () => {
    const sql = connect(url, { max: 1, ...opts }), fixture = await fixtureFor(sql);
    const a = fixture.manager, sameUser = fixture.second.manager, b = fixture.second.member;
    try {
      assertEquals(a.userId, sameUser.userId);
      const [{ id }] = await inWorkspace(sql, a, insertTask(a.workspaceId));
      for (const foreign of [sameUser, b]) {
        assertEquals((await inWorkspace(sql, foreign, (tx) => tx`select id from app.tasks where id=${id}`)).length, 0);
        assertEquals(
          (await inWorkspace(sql, foreign, (tx) => tx`update app.tasks set title='탈취' where id=${id}`)).count,
          0,
        );
        assertEquals((await inWorkspace(sql, foreign, (tx) => tx`delete from app.tasks where id=${id}`)).count, 0);
        assertMatch(
          await outcome(rawWorkspace(sql, foreign, insertTask(a.workspaceId))),
          /^23514 workspace_model_anchor_required/,
        );
      }
      assertEquals((await inWorkspace(sql, a, (tx) => tx`select id from app.tasks where id=${id}`)).length, 1);
      // A different current member with task READ sees the shared workspace row.
      await fixture.grant(fixture.member, [{ ...taskWrite, access: "read" }]);
      assertEquals(
        (await inWorkspace(sql, fixture.member, (tx) => tx`select id from app.tasks where id=${id}`)).length,
        1,
      );
      await fixture.grant(fixture.member, []);
      assertEquals(
        (await inWorkspace(sql, fixture.member, (tx) => tx`select id from app.tasks where id=${id}`)).length,
        0,
      );
    } finally {
      await fixture.cleanup();
      await sql.end();
    }
  });

  dbTest(`${name}: 커밋·롤백 뒤 역할·JWT·공간·권한 문맥 해제`, async () => {
    const sql = connect(url, { max: 1, ...opts }), fixture = await fixtureFor(sql);
    try {
      for (const rollback of [false, true]) {
        const result = await outcome(
          runInWorkspace(sql, fixture.manager, { mode: "business", requirements: [taskWrite] }, async (tx) => {
            const [active] = await tx`select current_user as role,current_setting('request.workspace_id') as workspace,
            current_setting('request.workspace_requirements')::jsonb as requirements`;
            assertEquals(active.role, "app_user");
            assertEquals(active.workspace, fixture.workspaceId);
            assertEquals(active.requirements, [taskWrite]);
            if (rollback) throw new Error("문맥 롤백 시험");
          }),
        );
        assertEquals(result === "ok", !rollback);
        const [context] = await sql`select current_user as role,
          coalesce(current_setting('request.jwt.claims',true),'') as jwt,
          coalesce(current_setting('request.workspace_id',true),'') as workspace,
          coalesce(current_setting('request.workspace_lock_mode',true),'') as mode,
          coalesce(current_setting('request.workspace_requirements',true),'') as requirements`;
        assertEquals(context, { role: "app_server", jwt: "", workspace: "", mode: "", requirements: "" });
        assertMatch(await outcome(sql`select count(*) from app.tasks`), /^42501 permission denied for schema app/);
      }
    } finally {
      await fixture.cleanup();
      await sql.end();
    }
  });

  dbTest(`${name}: 원본·상태·공간과 실행자가 담긴 큐의 원자적 커밋·롤백`, async () => {
    const sql = connect(url, { max: 1, ...opts }), fixture = await fixtureFor(sql), actor = fixture.manager;
    const body = "현재 색인 등록 원문", hash = await searchInputHash(body);
    const count = async () => {
      const [row] = await admin`select
        (select count(*)::int from app.records where workspace_id=${actor.workspaceId}) as records,
        (select count(*)::int from app.search_index_state where workspace_id=${actor.workspaceId}) as states,
        (select count(*)::int from pgmq.q_search_index where message->>'workspace_id'=${actor.workspaceId}) as msgs`;
      return row;
    };
    const insertAndEnqueue = async (tx: postgres.TransactionSql) => {
      const [{ id: taskId }] = await insertTask(actor.workspaceId)(tx);
      const [{ id }] = await tx<{ id: string }[]>`insert into app.records(workspace_id,body,record_kind,task_id)
        values(${actor.workspaceId},${body},'result',${taskId}) returning id`;
      await tx`select app.enqueue_search_index('record',${id},${hash},${SEARCH_PIPELINE})`;
    };
    try {
      assertEquals(await count(), { records: 0, states: 0, msgs: 0 });
      assert(
        (await outcome(inWorkspace(sql, actor, async (tx) => {
          await insertAndEnqueue(tx);
          throw new Error("색인 등록 뒤 실패");
        }))) !== "ok",
      );
      assertEquals(await count(), { records: 0, states: 0, msgs: 0 });
      await inWorkspace(sql, actor, insertAndEnqueue);
      assertEquals(await count(), { records: 1, states: 1, msgs: 1 });
      const [job] = await admin`select s.id,s.input_hash,s.pipeline,s.source_version::int,s.workspace_generation::int,
        s.initiated_by,s.required_permissions,m.message,r.task_id,r.entity_id,r.created_by,
        w.lifecycle_generation::int as current_epoch from app.search_index_state s
        join app.records r on r.workspace_id=s.workspace_id and r.id=s.id
        join app.workspaces w on w.id=s.workspace_id
        join pgmq.q_search_index m on m.msg_id=s.message_id where s.workspace_id=${actor.workspaceId}`;
      assertEquals(job.input_hash, hash);
      assertEquals(job.pipeline, SEARCH_PIPELINE);
      assertEquals(job.source_version, 1);
      assertEquals(job.workspace_generation, job.current_epoch);
      assertEquals(job.initiated_by, actor.userId);
      assertEquals(job.created_by, actor.userId);
      assertEquals(job.entity_id, null);
      assert(job.task_id);
      assertEquals(job.required_permissions, [taskWrite]);
      assertEquals(job.message, {
        workspace_id: actor.workspaceId,
        initiated_by: actor.userId,
        workspace_generation: job.current_epoch,
        source_version: 1,
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

dbTest("동일 풀 연결4개·200요청에서 사용자와 공간 문맥이 섞이지 않는다", async () => {
  const sql = connect(urls.pooler, { max: 4, prepare: false }), fixture = await fixtureFor(sql);
  try {
    for (const actor of [fixture.manager, fixture.second.manager]) {
      await inWorkspace(sql, actor, insertTask(actor.workspaceId));
    }
    const actors = [fixture.manager, fixture.member, fixture.second.manager, fixture.second.member];
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => {
      const actor = actors[i % actors.length];
      return inWorkspace(sql, actor, async (tx) => {
        const rows = await tx<{ workspace_id: string }[]>`select workspace_id from app.tasks`;
        assertEquals(rows.length, 1);
        return rows.every((row) => row.workspace_id === actor.workspaceId);
      });
    }));
    assert(results.every(Boolean));
  } finally {
    await fixture.cleanup();
    await sql.end();
  }
});

dbTest("anon·authenticated·app_server의 업무·큐 직접 접근 차단", async () => {
  const sql = connect(urls.direct, { max: 1 }), fixture = await fixtureFor(sql);
  try {
    for (const role of ["authenticated", "anon"]) {
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          assertEquals((await tx`select current_user as role`)[0].role, role);
          await tx`insert into app.tasks(workspace_id,kind,title,body,status) values(${fixture.workspaceId},'once','x','y','open')`;
        })),
        /^42501 permission denied for schema app/,
      );
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select pgmq.send('search_index','{}'::jsonb)`;
        })),
        /^42501 permission denied for (schema|function)/,
      );
    }
    assertMatch(await outcome(sql`select message from pgmq.q_search_index limit 1`), /^42501 permission denied/);
    assertMatch(await outcome(sql`select * from pgmq.read('search_index',30,1)`), /^42501 permission denied/);
  } finally {
    await fixture.cleanup();
    await sql.end();
  }
});

dbTest("app_server·app_user의 큐 전송·테이블·보조 함수 ACL", async () => {
  for (const role of ["app_server", "app_user"]) {
    assertEquals((await admin`select has_schema_privilege(${role},'pgmq','USAGE') as allowed`)[0].allowed, false);
    for (
      const query of [
        "select pgmq.send('search_index',$1::jsonb)",
        "select pgmq.send('search_index',$1::jsonb,'{}'::jsonb,now())",
        "insert into pgmq.q_search_index(message) values($1::jsonb)",
        "select msg_id from pgmq.q_search_index limit 1",
        "select pgmq.format_table_name('q','search_index')",
      ]
    ) {
      assertMatch(
        await outcome(admin.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          return tx.unsafe(query, query.includes("$1") ? [JSON.stringify({ workspace_id: crypto.randomUUID() })] : []);
        })),
        /^42501 permission denied/,
        `${role}: ${query}`,
      );
    }
  }
});

dbTest("접속·사용자 역할에 superuser·BYPASSRLS가 없다", async () => {
  const rows = await admin<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('app_server','app_user')`;
  assertEquals(rows.length, 2);
  for (const role of rows) assert(!role.rolsuper && !role.rolbypassrls, role.rolname);
});

dbTest("다른 공간의 불변 할 일 귀속은 복합 FK로 거부된다", async () => {
  const sql = connect(urls.direct, { max: 1 }), fixture = await fixtureFor(sql);
  try {
    const [{ id }] = await inWorkspace(sql, fixture.manager, insertTask(fixture.workspaceId));
    assertMatch(
      await outcome(
        rawWorkspace(
          sql,
          fixture.second.member,
          (tx) =>
            tx`insert into app.records(workspace_id,body,record_kind,task_id)
        values(${fixture.second.workspaceId},'기록','result',${id})`,
        ),
      ),
      /^42501 .*row-level security/,
    );
    // Bypass only RLS to inspect the actual composite FK on this exact owned fixture.
    assertMatch(
      await outcome(admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${fixture.second.workspaceId},true)`;
        await tx`insert into app.records(workspace_id,body,record_kind,task_id)
        values(${fixture.second.workspaceId},'기록','result',${id})`;
      })),
      /^23503 /,
    );
  } finally {
    await fixture.cleanup();
    await sql.end();
  }
});
