// Staged preservation check on the explicitly isolated readability stack. Never resets a DB.
import { assertEquals } from "@std/assert";
import postgres from "postgres";
const url = Deno.env.get("LOCAL_DB_URL")!;
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "57122") {
  throw Error("tag migration fixture requires isolated readability DB57122");
}
const [stage, file] = Deno.args;
if (!["prepare", "verify"].includes(stage) || !file) throw Error("prepare|verify <fixture-json>");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  if (stage === "prepare") {
    const f = {
      owner: crypto.randomUUID(),
      other: crypto.randomUUID(),
      tag: crypto.randomUUID(),
      unused: crypto.randomUUID(),
      task: crypto.randomUUID(),
      record: crypto.randomUUID(),
    };
    await sql.begin(async (tx) => {
      for (const owner of [f.owner, f.other]) {
        await tx`insert into auth.users(id,email) values(${owner},${`tag-migration-${owner}@example.test`})`;
      }
      await tx`insert into app.tags(id,owner_id,name,scope,version,created_at,updated_at) values
        (${f.tag},${f.owner},'共有','activity',3,'2026-01-01Z','2026-02-01Z'),
        (${f.unused},${f.owner},'未使用','activity',1,'2026-01-01Z','2026-02-01Z')`;
      await tx`insert into app.tags(owner_id,name,scope) values(${f.other},'共有','activity'),(${f.owner},'共有','entity')`;
      await tx`insert into app.tasks(id,owner_id,kind,status,title,body,version,updated_at) values(${f.task},${f.owner},'once','open','計画','原文',4,'2026-02-01Z')`;
      await tx`insert into app.records(id,owner_id,body,version,updated_at) values(${f.record},${f.owner},'過去の原文',2,'2026-02-01Z')`;
      await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${f.owner},${f.task},${f.tag})`;
      await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${f.owner},${f.record},${f.tag})`;
    });
    await Deno.writeTextFile(file, JSON.stringify(f));
    console.log("prepared shared and unused dictionaries, parents and another owner");
  } else {
    const f = JSON.parse(await Deno.readTextFile(file));
    try {
      const tags = await sql`select * from app.tags where owner_id=${f.owner} order by scope,name`;
      assertEquals(tags.length, 5);
      assertEquals(tags.filter((t) => t.scope === "task").map((t) => t.name), ["共有", "未使用"]);
      const recordTag = tags.find((t) => t.id === f.tag)!;
      assertEquals([recordTag.scope, recordTag.version, recordTag.updated_at.toISOString()], [
        "record",
        4,
        "2026-02-01T00:00:00.000Z",
      ]);
      const [linked] =
        await sql`select t.* from app.tags t join app.task_tags tt on tt.tag_id=t.id where tt.task_id=${f.task}`;
      assertEquals([linked.scope, linked.name, linked.id === f.tag], ["task", "共有", false]);
      assertEquals((await sql`select tag_id from app.record_tags where record_id=${f.record}`)[0].tag_id, f.tag);
      const [task] = await sql`select version,body,updated_at from app.tasks where id=${f.task}`;
      assertEquals([task.version, task.body, task.updated_at.toISOString()], [5, "原文", "2026-02-01T00:00:00.000Z"]);
      assertEquals((await sql`select body from app.records where id=${f.record}`)[0].body, "過去の原文");
      assertEquals((await sql`select count(*)::int n from app.records where owner_id=${f.owner}`)[0].n, 1);
      assertEquals((await sql`select count(*)::int n from app.tags where owner_id=${f.other}`)[0].n, 2);
      assertEquals((await sql`select count(*)::int n from app.tags where scope='activity'`)[0].n, 0);
      console.log(
        "PASS: dictionary names, unused tags, both relationships, dates, record IDs and body preserved; no fabricated history; versions prevent stale task writes",
      );
    } finally {
      await sql`delete from auth.users where id in (${f.owner},${f.other})`;
    }
  }
} finally {
  await sql.end();
}
