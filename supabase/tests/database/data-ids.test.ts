import { assert, assertEquals } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 4 });
const server = connect(urls.direct, { max: 4 });
const format = /^\d{8}-[A-Z0-9]{8}$/;
dbTest("서버 날짜형 ID 기본값은 모델 연결과 기존 참조를 지원한다", async () => {
  const owner = await fixtureOwner(admin);
  try {
    await asUser(server, owner.actor.userId, async (tx) => {
      const [tag] =
        await tx`insert into app.tags(owner_id,name,scope) values(${owner.actor.userId},'키 검증','task') returning id`;
      const [task] =
        await tx`insert into app.tasks(owner_id,kind,title,status) values(${owner.actor.userId},'once','키 검증','open') returning id`;
      const [record] =
        await tx`insert into app.records(owner_id,body,task_id) values(${owner.actor.userId},'키 검증',${task.id}) returning id`;
      await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${owner.actor.userId},${task.id},${tag.id})`;
      for (const value of [tag.id, task.id, record.id]) assert(format.test(value));
      const [linked] =
        await tx`select r.task_id,t.title from app.records r join app.tasks t on t.id=r.task_id and t.owner_id=r.owner_id where r.id=${record.id}`;
      assertEquals(linked.task_id, task.id);
    });
  } finally {
    await owner.cleanup();
  }
});
