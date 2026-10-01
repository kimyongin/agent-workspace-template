// T02-1 실험 1b: Edge Runtime(Deno)에서 npm:postgres로 같은 트랜잭션 계약이 동작하는지 확인한다.
// 격리 로컬 실험 전용. 앱 코드가 아니다.

import postgres from "npm:postgres@3.4.9";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

function serverUrl(host: string, port: number, user: string): string {
  return `postgresql://${user}:local-experiment-only@${host}:${port}/postgres`;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? ""} ${err.message ?? String(e)}`.trim();
  }
}

// 판정용 개수는 로컬 관리 연결(SUPABASE_DB_URL)로 센다. 접속 역할은 큐 내용을 읽을 수 없다.
async function counts(admin: postgres.Sql) {
  const [{ items }] = await admin`select count(*)::int as items from public.items`;
  const [{ msgs }] = await admin`select count(*)::int as msgs from pgmq.q_exp_index`;
  return { items, msgs };
}

async function suite(url: string, opts: Record<string, unknown>, admin: postgres.Sql) {
  const sql = postgres(url, { ...opts, max: 1, onnotice: () => {} });
  const asUser = <T>(sub: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: "authenticated" })}, true)`;
      await tx`set local role app_user`;
      return fn(tx);
    });
  const out: Record<string, unknown> = {};
  out.forged = await code(asUser(A, (tx) => tx`insert into public.items (owner_id, title) values (${B}, 'edge-forged')`));
  const before = await counts(admin);
  out.rollback = await code(asUser(A, async (tx) => {
    await tx`insert into public.items (owner_id, title) values (${A}, 'edge-rollback')`;
    await tx`reset role`;
    await tx`select pgmq.send('exp_index', ${tx.json({ edge: true })})`;
    throw new Error("fail after send");
  }));
  const after = await counts(admin);
  out.counts = { before, after };
  // 전송까지 성공한 뒤 일부러 실패시켰는지와 원본·큐가 모두 그대로인지 함께 본다.
  out.rolledBack = String(out.rollback).includes("fail after send") && before.items === after.items && before.msgs === after.msgs;
  const [ctx] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
  out.contextAfter = ctx;
  await sql.end();
  return out;
}

Deno.serve(async () => {
  const adminUrl = Deno.env.get("SUPABASE_DB_URL")!;
  const dbHost = new URL(adminUrl).hostname;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const poolerHost = "pooler"; // 로컬 Supabase 네트워크의 pooler 별칭
  const result: Record<string, unknown> = { dbHost, poolerHost };
  for (const [name, url, opts] of [
    ["direct", serverUrl(dbHost, 5432, "app_server"), {}],
    ["pooler-transaction", serverUrl(poolerHost, 6543, "app_server.pooler-dev"), { prepare: false }],
  ] as const) {
    try {
      result[name] = await suite(url, opts, admin);
    } catch (e) {
      result[name] = { error: (e as { code?: string }).code ?? String(e) };
    }
  }
  await admin.end();
  return Response.json(result);
});
