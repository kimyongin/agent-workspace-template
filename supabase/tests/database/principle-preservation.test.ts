import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const server = connect(urls.direct, { max: 1, prepare: false });

dbTest("원칙 보존: 최대 본문과 당시 적용 자료를 손실 없이 기록으로 캡처하고 반복 실행·권한을 지킨다", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const body = "가".repeat(19999) + "끝";
    const [source] = await admin`insert into app.principles(owner_id,title,summary,body,is_current,origin,saved_at)
      values(${f.actor.userId},'원본 원칙','원본 요약',${body},true,'legacy','2020-01-02T00:00:00Z') returning id`;
    const snapshots = [{
      title: "당시 제목",
      summary: "당시 요약",
      body: "실제 적용 당시 본문",
      captured_at: "application",
    }];
    const [decision] =
      await admin`insert into app.records(owner_id,title,summary,body,occurred_at,applied_principle_snapshots)
      values(${f.actor.userId},'당시 판단','판단 요약','판단 내용','2021-02-03T00:00:00Z',${
        admin.json(snapshots)
      }) returning id`;
    await admin`insert into app.record_principles(owner_id,record_id,principle_id) values(${f.actor.userId},${decision.id},${source.id})`;
    const started = Date.now();
    await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
    const parts =
      await admin`select m.source_kind,m.part,r.* from app.legacy_principle_record_parts m join app.records r on r.id=m.record_id and r.owner_id=m.owner_id where m.owner_id=${f.actor.userId} order by m.source_kind,m.part`;
    assert(parts.length >= 4);
    const payload = (kind: string) =>
      JSON.parse(parts.filter((r) => r.source_kind === kind).map((r) => r.body.split("\n\n", 2)[1]).join(""));
    const preserved = payload("principle");
    assertEquals(preserved.principle.body, body);
    assertEquals(preserved.principle.title, "원본 원칙");
    assertEquals(preserved.principle.saved_at, "2020-01-02T00:00:00+00:00");
    const applied = payload("record_principle_context");
    assertEquals(applied.applied_principle_snapshots, snapshots);
    assertEquals(applied.source_record.id, decision.id);
    assertEquals(applied.linked_principles_at_capture[0].body, body);
    for (const r of parts) {
      assertEquals(r.record_kind, "user");
      assert(r.occurred_at.getTime() >= started - 1000);
      assert(r.body.includes("실제 적용 시각이 아닙니다"));
      assert([...r.body].length <= 20000);
    }
    await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
    assertEquals(
      (await admin`select count(*)::int n from app.legacy_principle_record_parts where owner_id=${f.actor.userId}`)[0]
        .n,
      parts.length,
    );
    await asUser(server, f.actor.userId, async (tx) => {
      assertEquals((await tx`select record_id from app.legacy_principle_record_parts`).length, parts.length);
      await tx`delete from app.records where id=${parts[0].id}`;
    });
    await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
    assertEquals((await admin`select id from app.records where id=${parts[0].id}`).length, 0);
    await asUser(
      server,
      other.actor.userId,
      async (tx) => assertEquals((await tx`select record_id from app.legacy_principle_record_parts`).length, 0),
    );
    await assertRejects(() =>
      asUser(server, f.actor.userId, (tx) => tx`call private.preserve_principle_sources(${f.actor.userId}::uuid)`)
    );
    assertEquals((await admin`select body from app.records where id=${decision.id}`)[0].body, "판단 내용");
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});

Deno.test({
  name: "close principle preservation DB clients",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await admin.end();
    await server.end();
  },
});
