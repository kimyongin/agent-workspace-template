// 대조 실험: 트랜잭션 한정(set local, is_local=true) 대신 세션 설정을 쓰면 문맥이 연결에 남는지 확인한다.
import postgres from "postgres";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const url = "postgresql://app_server:local-experiment-only@127.0.0.1:55322/postgres";
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A })}, false)`;
  await tx`set role app_user`;
});
const [ctx] = await sql`select current_user as u, coalesce(current_setting('request.jwt.claims', true), '') as c`;
const rows = await sql`select count(*)::int as n from public.items`;
console.log(ctx.u !== "app_server" || ctx.c !== "" ? "DETECTED leak" : "no leak", JSON.stringify(ctx), `items visible: ${rows[0].n}`);
await sql.end();
