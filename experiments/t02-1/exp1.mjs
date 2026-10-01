// T02-1 실험 1: 직접 Postgres 트랜잭션의 Actor 문맥·RLS·큐 원자성 (격리 로컬 Supabase 전용).
// 사용: npm run exp1  (supabase start 이후)

import postgres from "postgres";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const PASSWORD = "local-experiment-only";

const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const TARGETS = [
  { name: "direct", url: `postgresql://app_server:${PASSWORD}@127.0.0.1:55322/postgres`, opts: {} },
  {
    name: "pooler-transaction",
    url: `postgresql://app_server.pooler-dev:${PASSWORD}@127.0.0.1:55329/postgres`,
    opts: { prepare: false },
  },
];

// 검증된 Actor를 트랜잭션 안에서만 전달한다. 큐 전송은 서버 역할로 되돌린 뒤 수행한다.
async function asUser(sql, sub, fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: "authenticated" })}, true)`;
    await tx`set local role app_user`;
    return fn(tx);
  });
}

// 실패 이유까지 확인하려고 오류 코드와 메시지를 함께 돌려준다. 같은 코드(42501)라도 원인이 다를 수 있다.
async function outcome(promise) {
  try {
    await promise;
    return { ok: true, text: "ok" };
  } catch (e) {
    return { ok: false, code: e.code, text: `${e.code ?? ""} ${e.message}`.trim() };
  }
}
const deniedBy = (r, pattern) => !r.ok && r.code === "42501" && pattern.test(r.text);

async function counts(admin) {
  const [{ items }] = await admin`select count(*)::int as items from public.items`;
  const [{ msgs }] = await admin`select count(*)::int as msgs from pgmq.q_exp_index`;
  return { items, msgs };
}

async function run(target, admin) {
  const results = [];
  const check = (id, desc, pass, detail) => results.push({ target: target.name, id, desc, pass, detail });
  const sql = postgres(target.url, { ...target.opts, max: 1, onnotice: () => {} });

  await admin`truncate public.items`;
  await admin`delete from pgmq.q_exp_index`;

  // C1·C2 소유자 문맥의 쓰기
  check("C1", "자기 소유 행 쓰기 허용", (await outcome(asUser(sql, A, (tx) => tx`insert into public.items (owner_id, title) values (${A}, 'a1')`))).ok);
  await asUser(sql, B, (tx) => tx`insert into public.items (owner_id, title) values (${B}, 'b1')`);
  const c2 = await outcome(asUser(sql, A, (tx) => tx`insert into public.items (owner_id, title) values (${B}, 'forged')`));
  check("C2", "다른 소유자로 쓰기 거부(RLS)", deniedBy(c2, /row-level security/), c2.text);

  // C3 읽기 격리
  const seen = await asUser(sql, A, (tx) => tx`select owner_id from public.items`);
  check("C3", "A는 A의 행만 조회", seen.length === 1 && seen[0].owner_id === A, `${seen.length}행`);

  // C4 커밋·롤백 후 같은 연결에 문맥이 남지 않음
  const [after] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
  check("C4a", "커밋 후 연결의 역할·claims 해제", after.u === "app_server" && after.c === "", JSON.stringify(after));
  await outcome(asUser(sql, A, async (tx) => {
    await tx`select 1`;
    throw new Error("rollback");
  }));
  const [afterRb] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
  check("C4b", "롤백 후 연결의 역할·claims 해제", afterRb.u === "app_server" && afterRb.c === "", JSON.stringify(afterRb));

  // C5 문맥 없는 서버 역할은 업무 테이블에 접근 불가
  const c5 = await outcome(sql`select * from public.items`);
  check("C5", "문맥 없는 접속 역할의 업무 테이블 접근 거부", deniedBy(c5, /permission denied for table items/), c5.text);

  // C6·C7 원본 저장과 pgmq.send의 원자성
  const before = await counts(admin);
  const c6 = await outcome(asUser(sql, A, async (tx) => {
    await tx`insert into public.items (owner_id, title) values (${A}, 'will-rollback')`;
    await tx`reset role`;
    await tx`select pgmq.send('exp_index', ${tx.json({ kind: "item", owner: A })})`;
    throw new Error("fail after send");
  }));
  const rolled = await counts(admin);
  // 전송까지 성공한 뒤 일부러 실패시켰는지(오류 메시지)와 원본·큐가 모두 그대로인지 함께 본다.
  check("C6", "전송 후 실패 시 원본과 큐 메시지 함께 롤백", c6.text.includes("fail after send") && rolled.items === before.items && rolled.msgs === before.msgs, JSON.stringify({ error: c6.text, before, rolled }));
  await asUser(sql, A, async (tx) => {
    await tx`insert into public.items (owner_id, title) values (${A}, 'committed')`;
    await tx`reset role`;
    await tx`select pgmq.send('exp_index', ${tx.json({ kind: "item", owner: A })})`;
  });
  const committed = await counts(admin);
  check("C7", "성공 시 원본과 큐 메시지 함께 커밋", committed.items === before.items + 1 && committed.msgs === before.msgs + 1, JSON.stringify(committed));

  // C11 접속 역할은 큐에 보내기만 하고 읽기·삭제는 못 한다
  const c11a = await outcome(sql`select message from pgmq.q_exp_index`);
  check("C11a", "접속 역할의 큐 메시지 내용 조회 거부", deniedBy(c11a, /permission denied for table q_exp_index/), c11a.text);
  const c11b = await outcome(sql`select * from pgmq.read('exp_index', 30, 1)`);
  check("C11b", "접속 역할의 큐 메시지 읽기(소비) 거부", deniedBy(c11b, /permission denied/), c11b.text);
  const c11c = await outcome(sql`select pgmq.delete('exp_index', 1::bigint)`);
  check("C11c", "접속 역할의 큐 메시지 삭제 거부", deniedBy(c11c, /permission denied/), c11c.text);

  await sql.end();

  // C10 동시 요청의 문맥 교차 없음(연결 4개, 요청 200개)
  const pool = postgres(target.url, { ...target.opts, max: 4, onnotice: () => {} });
  let leaks = 0;
  await Promise.all(
    Array.from({ length: 200 }, (_, i) => {
      const sub = i % 2 ? A : B;
      return asUser(pool, sub, async (tx) => {
        await tx`insert into public.items (owner_id, title) values (${sub}, ${"c" + i})`;
        await tx`select pg_sleep(0.002)`;
        const rows = await tx`select owner_id from public.items`;
        if (rows.some((r) => r.owner_id !== sub)) leaks += 1;
      });
    }),
  );
  check("C10", "동시 200요청에서 다른 사용자 행 노출 없음", leaks === 0, `노출 ${leaks}건`);
  await pool.end();
  return results;
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
const [roles] = await admin`
  select bool_or(rolsuper) as su, bool_or(rolbypassrls) as bypass
  from pg_roles where rolname in ('app_server', 'app_user')`;
const all = [{ target: "roles", id: "C9", desc: "접속·전환 역할에 superuser·BYPASSRLS 없음", pass: !roles.su && !roles.bypass, detail: JSON.stringify(roles) }];

// C8 일반 사용자 경로(Supabase API의 authenticated 역할)의 직접 쓰기 차단.
// app_server는 authenticated로 전환할 수 없으므로, API 게이트웨이처럼 전환 권한이 있는 관리 연결에서 역할을 바꾼 뒤 시험한다.
async function asAuthenticated(fn) {
  return admin.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    const [{ u }] = await tx`select current_user as u`;
    if (u !== "authenticated") throw new Error(`role switch failed: ${u}`);
    return fn(tx);
  });
}
const c8 = await outcome(asAuthenticated((tx) => tx`insert into public.items (owner_id, title) values (${A}, 'direct')`));
all.push({ target: "roles", id: "C8", desc: "authenticated 역할의 업무 테이블 직접 쓰기 거부", pass: deniedBy(c8, /permission denied for table items/), detail: c8.text });
const c8b = await outcome(asAuthenticated((tx) => tx`select pgmq.send('exp_index', ${tx.json({ forged: true })})`));
all.push({ target: "roles", id: "C8b", desc: "authenticated 역할의 큐 전송 거부", pass: deniedBy(c8b, /permission denied for schema pgmq/), detail: c8b.text });
const c8c = await outcome(asAuthenticated((tx) => tx`select 1`));
all.push({ target: "roles", id: "C8c", desc: "대조: 관리 연결에서 authenticated 전환 자체는 성공", pass: c8c.ok, detail: c8c.text });
for (const target of TARGETS) {
  try {
    all.push(...(await run(target, admin)));
  } catch (e) {
    all.push({ target: target.name, id: "connect", desc: "연결", pass: false, detail: `${e.code ?? ""} ${e.message}` });
  }
}
await admin.end();

for (const r of all) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.target} ${r.id} ${r.desc}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = all.filter((r) => !r.pass).length;
console.log(`\n${all.length - failed}/${all.length} 통과`);
process.exit(failed ? 1 : 0);
