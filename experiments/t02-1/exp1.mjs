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

async function code(promise) {
  try {
    await promise;
    return "ok";
  } catch (e) {
    return e.code ?? e.message;
  }
}

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
  check("C1", "자기 소유 행 쓰기 허용", (await code(asUser(sql, A, (tx) => tx`insert into public.items (owner_id, title) values (${A}, 'a1')`))) === "ok");
  await asUser(sql, B, (tx) => tx`insert into public.items (owner_id, title) values (${B}, 'b1')`);
  const c2 = await code(asUser(sql, A, (tx) => tx`insert into public.items (owner_id, title) values (${B}, 'forged')`));
  check("C2", "다른 소유자로 쓰기 거부(RLS)", c2 === "42501", c2);

  // C3 읽기 격리
  const seen = await asUser(sql, A, (tx) => tx`select owner_id from public.items`);
  check("C3", "A는 A의 행만 조회", seen.length === 1 && seen[0].owner_id === A, `${seen.length}행`);

  // C4 커밋·롤백 후 같은 연결에 문맥이 남지 않음
  const [after] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
  check("C4a", "커밋 후 연결의 역할·claims 해제", after.u === "app_server" && after.c === "", JSON.stringify(after));
  await code(asUser(sql, A, async (tx) => {
    await tx`select 1`;
    throw new Error("rollback");
  }));
  const [afterRb] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
  check("C4b", "롤백 후 연결의 역할·claims 해제", afterRb.u === "app_server" && afterRb.c === "", JSON.stringify(afterRb));

  // C5 문맥 없는 서버 역할은 업무 테이블에 접근 불가
  const c5 = await code(sql`select * from public.items`);
  check("C5", "문맥 없는 접속 역할의 업무 테이블 접근 거부", c5 === "42501", c5);

  // C6·C7 원본 저장과 pgmq.send의 원자성
  const before = await counts(admin);
  await code(asUser(sql, A, async (tx) => {
    await tx`insert into public.items (owner_id, title) values (${A}, 'will-rollback')`;
    await tx`reset role`;
    await tx`select pgmq.send('exp_index', ${tx.json({ kind: "item", owner: A })})`;
    throw new Error("fail after send");
  }));
  const rolled = await counts(admin);
  check("C6", "실패 시 원본과 큐 메시지 함께 롤백", rolled.items === before.items && rolled.msgs === before.msgs, JSON.stringify({ before, rolled }));
  await asUser(sql, A, async (tx) => {
    await tx`insert into public.items (owner_id, title) values (${A}, 'committed')`;
    await tx`reset role`;
    await tx`select pgmq.send('exp_index', ${tx.json({ kind: "item", owner: A })})`;
  });
  const committed = await counts(admin);
  check("C7", "성공 시 원본과 큐 메시지 함께 커밋", committed.items === before.items + 1 && committed.msgs === before.msgs + 1, JSON.stringify(committed));

  // C8 일반 사용자 경로(authenticated)의 직접 쓰기 차단
  const c8 = await code(sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    await tx`insert into public.items (owner_id, title) values (${A}, 'direct')`;
  }));
  check("C8", "authenticated 역할의 직접 쓰기 거부", c8 === "42501", c8);
  const c8b = await code(sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select pgmq.send('exp_index', ${tx.json({ forged: true })})`;
  }));
  check("C8b", "authenticated 역할의 큐 전송 거부", c8b !== "ok", c8b);

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
for (const target of TARGETS) {
  try {
    all.push(...(await run(target, admin)));
  } catch (e) {
    all.push({ target: target.name, id: "connect", desc: "연결", pass: false, detail: e.code ?? e.message });
  }
}
await admin.end();

for (const r of all) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.target} ${r.id} ${r.desc}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = all.filter((r) => !r.pass).length;
console.log(`\n${all.length - failed}/${all.length} 통과`);
process.exit(failed ? 1 : 0);
