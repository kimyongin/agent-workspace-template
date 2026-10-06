import { assertEquals } from "@std/assert";
import { connect, dbTest, urls } from "../database/_db.ts";
import { recordBody } from "../../functions/_shared/contracts/common.ts";
const url = new URL(urls.admin);
if (url.hostname !== "127.0.0.1" || !["56122", "56222", "57122"].includes(url.port)) {
  throw Error("Requires isolated predecessor DB");
}
const admin = connect(urls.admin, { max: 1 });
const migration = await Deno.readTextFile(
  new URL("../../migrations/20261007000001_minimal_content_model.sql", import.meta.url),
);
dbTest("minimal content migration preserves unique retired content, metadata and editable Unicode bodies", async () => {
  const rollback = Error("rollback fixture");
  try {
    await admin.begin(async (tx) => {
      const owner = crypto.randomUUID(),
        id = crypto.randomUUID(),
        empty = crypto.randomUUID(),
        duplicate = crypto.randomUUID();
      await tx`insert into auth.users(id,email) values(${owner},${`${owner}@example.test`})`;
      const body = "😀".repeat(20000), title = "가".repeat(100), summary = "나".repeat(300), note = "다".repeat(1000);
      const metadata = {
        event_id: crypto.randomUUID(),
        target_id: crypto.randomUUID(),
        target_kind: "entity",
        target_title: "이전 대상",
        action: "update",
        source: "mcp",
        before: { prop1: "이전" },
        after: { prop1: "다음" },
        path: null,
      };
      await tx`insert into app.records(id,owner_id,title,summary,body,change_note,record_kind,version,change_metadata)
        values(${id},${owner},${title},${summary},${body},${note},'change',7,${tx.json(metadata)})`;
      await tx`insert into app.records(id,owner_id,title,summary,body) values(${empty},${owner},'옛 제목','옛 요약',''),(${duplicate},${owner},'내용','내용','내용')`;
      const task = crypto.randomUUID(), principle = crypto.randomUUID();
      await tx`insert into app.tasks(id,owner_id,kind,title,summary,body,status) values(${task},${owner},'once','업무','업무 요약','업무 본문','open')`;
      await tx`insert into app.principles(id,owner_id,title,summary,body,is_current,change_note) values(${principle},${owner},'원칙','원칙 요약','원칙 본문',true,'저장 메모')`;
      await tx.unsafe(migration);
      const [row] = await tx`select * from app.records where id=${id}`;
      const expected = `${body}\n\n${title}\n\n${summary}\n\n${note}`;
      assertEquals(row.body, expected);
      assertEquals(recordBody.parse(row.body), expected);
      assertEquals([row.id, row.version, row.change_metadata], [id, 7, metadata]);
      assertEquals(["title", "summary", "change_note"].some((key) => key in row), false);
      assertEquals((await tx`select body from app.records where id=${empty}`)[0].body, "옛 제목\n\n옛 요약");
      assertEquals((await tx`select body from app.records where id=${duplicate}`)[0].body, "내용");
      assertEquals((await tx`select body from app.tasks where id=${task}`)[0].body, "업무 본문\n\n업무 요약");
      assertEquals(
        (await tx`select body from app.principles where id=${principle}`)[0].body,
        "원칙 본문\n\n원칙 요약\n\n저장 메모",
      );
      await tx`update app.records set body=${expected + "\n편집"} where id=${id}`;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
