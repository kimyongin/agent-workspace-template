import { assert, assertEquals } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 4 });
const server = connect(urls.direct, { max: 4 });
const rootUrl = new URL(urls.admin);
rootUrl.username = "postgres";
rootUrl.password = "postgres";
const localRoot = connect(rootUrl.toString(), { max: 1 });
const format = /^\d{8}-[A-Z0-9]{8}$/;
dbTest("공통 자동 ID 예약은 동시 발급·모델 연결에서 중복되지 않는다", async () => {
  const owner = await fixtureOwner(admin);
  try {
    const ids = await Promise.all(Array.from({ length: 32 }, () =>
      asUser(server, owner.actor.userId, async (tx) => {
        const [row] = await tx`select app.issue_data_id() id`;
        return row.id as string;
      })));
    assertEquals(new Set(ids).size, 32);
    ids.forEach((id) => assert(format.test(id)));
    await asUser(server, owner.actor.userId, async (tx) => {
      const [tag] =
        await tx`insert into app.tags(owner_id,name,scope) values(${owner.actor.userId},'키 검증','task') returning id`;
      const [task] =
        await tx`insert into app.tasks(owner_id,kind,title,status) values(${owner.actor.userId},'once','키 검증','open') returning id`;
      const [record] =
        await tx`insert into app.records(owner_id,body,task_id) values(${owner.actor.userId},'키 검증',${task.id}) returning id`;
      await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${owner.actor.userId},${task.id},${tag.id})`;
      const [principle] =
        await tx`insert into app.principles(owner_id,title,body,is_current) values(${owner.actor.userId},'키 검증','',true) returning id`;
      for (const value of [tag.id, task.id, record.id, principle.id]) assert(format.test(value));
      const [linked] =
        await tx`select r.task_id,t.title from app.records r join app.tasks t on t.id=r.task_id and t.owner_id=r.owner_id where r.id=${record.id}`;
      assertEquals(linked.task_id, task.id);
    });
  } finally {
    await owner.cleanup();
  }
});
dbTest("랜덤 후보 충돌 시 다른 후보를 재발급한다 (검증 RNG는 트랜잭션 롤백)", async () => {
  const sentinel = new Error("rollback RNG test");
  try {
    await localRoot.begin(async (tx) => {
      await tx`create temporary table id_rng_calls(n integer)`;
      await tx`insert into id_rng_calls values(0)`;
      await tx.unsafe(
        `create or replace function app.data_id_candidate() returns text language plpgsql volatile as $$ declare calls integer; begin update pg_temp.id_rng_calls set n=id_rng_calls.n+1 returning id_rng_calls.n into calls; return to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD')||case when calls=1 then '-00000000' else '-11111111' end; end $$`,
      );
      const [date] = await tx`select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYYMMDD') prefix`;
      await tx`insert into private.data_id_reservations(id) values(${
        date.prefix + "-00000000"
      }) on conflict do nothing`;
      const [generated] = await tx`select app.issue_data_id() id`;
      assertEquals(generated.id, date.prefix + "-11111111");
      const [calls] = await tx`select n from id_rng_calls`;
      assertEquals(calls.n, 2);
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
});
