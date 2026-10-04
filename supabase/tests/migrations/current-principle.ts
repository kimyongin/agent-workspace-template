// Run prepare against migration13, apply the new migration, then verify on the same disposable stack.
// The script never resets databases. Only the explicit external CLI command does that.
import { assert, assertEquals } from "@std/assert";
import postgres from "postgres";
const url = Deno.env.get("LOCAL_DB_URL")!;
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "56422") {
  throw Error("migration fixture requires template20server DB56422");
}
const [stage, file] = Deno.args;
if (!["prepare", "verify"].includes(stage) || !file) throw Error("prepare|verify <fixture-json>");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  if (stage === "prepare") {
    const f = {
      owner: crypto.randomUUID(),
      entity: crypto.randomUUID(),
      tag: crypto.randomUUID(),
      task: crypto.randomUUID(),
      record: crypto.randomUUID(),
      principles: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
    };
    await sql.begin(async (tx) => {
      await tx`insert into auth.users(id,email) values(${f.owner},${`migration-${f.owner}@example.test`})`;
      await tx`insert into app.entities(id,owner_id,prop1) values(${f.entity},${f.owner},'기존 대상')`;
      await tx`insert into app.tags(id,owner_id,name) values(${f.tag},${f.owner},'기존 분류')`;
      for (const [n, id] of f.principles.entries()) {
        await tx`insert into app.principles(id,owner_id,title,summary,body,applies_when,status,entity_id,created_at,updated_at)
   values(${id},${f.owner},${`원칙 ${n}`},'기존 요약',${`기존 본문 ${n}`},'기존 조건',${
          n === 2 ? "inactive" : "active"
        },${f.entity},${`2026-01-0${n + 1}T00:00:00Z`},'2026-02-01T00:00:00Z')`;
      }
      await tx`insert into app.principle_tags(owner_id,principle_id,tag_id) values(${f.owner},${
        f.principles[0]
      },${f.tag})`;
      await tx`insert into app.tasks(id,owner_id,kind,status,title,summary) values(${f.task},${f.owner},'once','open','기존 계획','기존 요약')`;
      await tx`insert into app.records(id,owner_id,title,summary,body) values(${f.record},${f.owner},'기존 판단','기존 요약','당시 판단')`;
      await tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${f.owner},${f.task},${f.tag})`;
      await tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${f.owner},${f.record},${f.tag})`;
      await tx`insert into app.record_principles(owner_id,record_id,principle_id) values(${f.owner},${f.record},${
        f.principles[0]
      })`;
    });
    await Deno.writeTextFile(file, JSON.stringify(f));
    console.log("Prepared migration13 fixture: 3 independent legacy principles + preserved links, no history invented");
  } else {
    const f = JSON.parse(await Deno.readTextFile(file));
    const rows = await sql`select * from app.principles where owner_id=${f.owner} order by created_at`;
    assertEquals(rows.length, 3);
    assertEquals(rows.filter((r) => r.is_current).map((r) => r.id), [f.principles[1]]);
    for (const [n, r] of rows.entries()) {
      assertEquals(r.body, `기존 본문 ${n}`);
      assertEquals(r.origin, "legacy");
      assertEquals(r.change_note, null);
      assertEquals(r.entity_id, f.entity);
      assertEquals(r.applies_when, "기존 조건");
      assertEquals(r.saved_at.toISOString(), r.created_at.toISOString());
    }
    assertEquals(rows[0].legacy_context.tag_ids, [f.tag]);
    assertEquals(rows[0].legacy_context.tags[0].name, "기존 분류");
    const [record] = await sql`select * from app.records where id=${f.record}`;
    assertEquals(record.body, "당시 판단");
    assertEquals(record.record_kind, "user");
    assertEquals(record.applied_principle_snapshots[0].captured_at, "migration");
    assertEquals(record.applied_principle_snapshots[0].body, "기존 본문 0");
    for (const table of ["task_tags", "record_tags", "principle_tags", "record_principles"]) {
      assertEquals((await sql`select * from ${sql(`app.${table}`)} where owner_id=${f.owner}`).length, 1);
    }
    assertEquals((await sql`select scope from app.tags where id=${f.tag}`)[0].scope, "activity");
    assertEquals((await sql`select * from app.records where owner_id=${f.owner} and record_kind='change'`).length, 0);
    assertEquals((await sql`select * from app.search_index_state where owner_id=${f.owner}`).length, 0);
    const denied = await sql`select has_table_privilege('app_user','app.principle_tags','INSERT') as insert_allowed`;
    assertEquals(denied[0].insert_allowed, false);
    const exposed = await sql`select has_table_privilege('authenticated','app.entity_tags','SELECT') as allowed`;
    assertEquals(exposed[0].allowed, false);
    assert(rows[1].is_current);
    await sql`delete from auth.users where id=${f.owner}`;
    console.log(
      "Migration verification PASS: exact legacy preservation, deterministic current, scoped tags, captured-at-migration disclaimer, no fictional events/index jobs, grants",
    );
  }
} finally {
  await sql.end();
}
