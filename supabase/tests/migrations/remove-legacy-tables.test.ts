import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "../database/_db.ts";
import { appliedPrincipleSnapshot, recordResult, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { principleUpdate } from "../../functions/_shared/contracts/principle.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as principle from "../../functions/_shared/core/principles/application.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";

// Run only on the owned predecessor stack described in migrations/README.md.
const migrationDb = new URL(Deno.env.get("LOCAL_DB_URL") ?? "");
if (migrationDb.hostname !== "127.0.0.1" || !["56122", "56222"].includes(migrationDb.port)) {
  throw Error("Requires owned isolated DB56122/56222");
}
const migrationFile = new URL("../../migrations/20261006210000_remove_legacy_principle_tables.sql", import.meta.url);
const admin = connect(urls.admin, { max: 1 });
const server = connect(urls.direct, { max: 1, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(server) },
  ad = { uow: new SqlUnitOfWork(server), clock: { now: () => new Date() } },
  pd = { uow: new SqlPrincipleUnitOfWork(server) };

dbTest(
  "과거 테이블 제거: 긴 원문을 기록으로 보존하고 사용자 편집·삭제를 존중한다",
  async () => {
    const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
    try {
      const first = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "이전 단일 대상" } }),
      );
      const second = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "삭제할 대상" } }),
      );
      const ids = [first.id, second.id].sort();
      const legacyTask = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "옛 단일 업무", summary: "보존", entity_ids: [first.id] },
        }),
      );
      const multi = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "여러 대상", summary: "보존", entity_ids: ids },
        }),
      );
      const unlinked = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ id: crypto.randomUUID(), ...{ kind: "once", title: "대상 없음", summary: "선택 사항" } }),
      );
      const linkedRecord = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({
          id: crypto.randomUUID(),
          ...{ title: "당시 여러 대상", summary: "문맥", entity_ids: ids },
        }),
      );
      const legacyChange = {
        event_id: crypto.randomUUID(),
        target_kind: "entity" as const,
        target_id: first.id,
        target_title: "당시 이름",
        action: "update" as const,
        source: "http" as const,
        path: `/entities/${first.id}`,
        before: { prop1: "이전", body: "옛 전체 원문" },
        after: { prop1: "당시 이름", prop2: 42 },
      };
      const [oldEvent] = await admin`insert into app.records(owner_id,title,summary,body,record_kind,change_metadata)
      values(${f.actor.userId},'옛 사건','정확한 캡처','부분 메모','change',${admin.json(legacyChange)}) returning id`;
      const body = "😀".repeat(19999) + "끝";
      const [source] = await admin`insert into app.principles(owner_id,title,summary,body,is_current,origin,saved_at)
      values(${f.actor.userId},'원본 원칙','원본 요약',${body},true,'legacy','2020-01-02T00:00:00Z') returning id`;
      const snapshots = [appliedPrincipleSnapshot.parse({
        id: source.id,
        title: "당시 제목",
        summary: "당시 요약",
        body: "실제 적용 당시 본문",
        version: 1,
        status: "active",
        saved_at: "2020-01-02T00:00:00.000Z",
        captured_at: "application",
      })];
      const [decision] =
        await admin`insert into app.records(owner_id,entity_ids,title,summary,body,occurred_at,applied_principle_snapshots)
      values(${f.actor.userId},array[${first.id}::uuid],'당시 판단','판단 요약','판단 내용','2021-02-03T00:00:00Z',${
          admin.json(snapshots)
        }) returning id`;
      await admin`insert into app.record_principles(owner_id,record_id,principle_id) values(${f.actor.userId},${decision.id},${source.id})`;
      // Post-cutoff recovery fixture: authoritative complete payloads, no product writer.
      await admin`insert into private.retired_principle_sources(owner_id,source_kind,source_id,title,summary,payload)
        select owner_id,'principle',id,title,summary,jsonb_build_object('principle',to_jsonb(p)) from app.principles p where id=${source.id}`;
      await admin`insert into private.retired_principle_sources(owner_id,source_kind,source_id,title,summary,payload)
        select owner_id,'record_principle_context',id,title,summary,jsonb_build_object('source_record',jsonb_build_object('id',id,'title',title,'occurred_at',occurred_at),
          'applied_principle_snapshots',applied_principle_snapshots,'linked_principles_at_capture',(select jsonb_agg(to_jsonb(p)) from app.principles p where id=${source.id})) from app.records where id=${decision.id}`;
      const started = Date.now();
      await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
      const parts =
        await admin`select m.source_kind,m.source_hash,m.part,r.* from app.legacy_principle_record_parts m join app.records r on r.id=m.record_id and r.owner_id=m.owner_id where m.owner_id=${f.actor.userId} order by m.source_kind,m.part`;
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
      assertEquals(applied.source_record.occurred_at, "2021-02-03T00:00:00+00:00");
      assertEquals(applied.linked_principles_at_capture[0].body, body);
      for (const r of parts) {
        assertEquals(r.record_kind, "user");
        assert(r.occurred_at.getTime() >= started - 1000);
        assert(r.body.includes("실제 적용 시각이 아닙니다"));
        assert([...r.body].length <= 20000);
        recordUpdate.parse({ expected_version: r.version, title: r.title, summary: r.summary, body: r.body });
        assertEquals((await activity.getRecord(ad, f.actor, r.id)).body, r.body);
        await assertRejects(() => activity.getRecord(ad, other.actor, r.id));
      }
      assertEquals((await activity.getRecord(ad, f.actor, oldEvent.id)).change, legacyChange);
      const sd = { uow: new SqlSearchUnitOfWork(server) };
      const query = searchInput.parse({ query: "실제 적용 당시 본문", kinds: ["record"], mode: "keyword", limit: 100 });
      const found = await search(sd, f.actor, query);
      assert(found.items.some((row) => row.id === parts.find((r) => r.source_kind === "record_principle_context")!.id));
      assertEquals((await search(sd, other.actor, query)).items, []);
      const decisionRead = recordResult.parse(await activity.getRecord(ad, f.actor, decision.id));
      assertEquals(decisionRead.applied_principle_snapshots, snapshots);
      assertEquals("applied_principles" in decisionRead, false);
      assertEquals((await activity.getRecord(ad, f.actor, decision.id)).entity_ids, [first.id]);
      assertEquals((await activity.getTask(ad, f.actor, legacyTask.id)).entity_ids, [first.id]);
      assertEquals((await activity.getTask(ad, f.actor, unlinked.id)).entity_ids, []);
      await entity.deleteEntity(ed, f.actor, second.id, second.version);
      assertEquals((await activity.getTask(ad, f.actor, multi.id)).entity_ids, [first.id]);
      const retained = await activity.getRecord(ad, f.actor, linkedRecord.id);
      assertEquals(retained.entity_ids, ids);
      assertEquals(retained.entity_context, linkedRecord.entity_context);
      await assertRejects(() => activity.getRecord(ad, other.actor, linkedRecord.id));
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
      // Live edits after the cutoff cannot turn the exact archive into a truncated new source.
      const original = await principle.getPrinciple(pd, f.actor, source.id);
      const edited = await principle.updatePrinciple(
        pd,
        f.actor,
        original.id,
        principleUpdate.parse({
          title: original.title,
          summary: original.summary,
          body: "현재 원칙 변경",
          expected_version: original.version,
        }),
      );
      const beforeParts =
        await admin`select source_hash,part,record_id,captured_at from app.legacy_principle_record_parts where owner_id=${f.actor.userId} order by source_kind,part`;
      await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
      assertEquals(
        await admin`select source_hash,part,record_id,captured_at from app.legacy_principle_record_parts where owner_id=${f.actor.userId} order by source_kind,part`,
        beforeParts,
      );
      assertEquals(
        (await admin`select payload from private.retired_principle_sources where owner_id=${f.actor.userId} and source_kind='principle'`)[
          0
        ].payload.principle.body,
        body,
      );
      assertEquals(edited.body, "현재 원칙 변경");
      await activity.updateRecord(
        ad,
        f.actor,
        parts[1].id,
        recordUpdate.parse({ expected_version: parts[1].version, body: "사용자가 편집한 보존 메모" }),
      );
      const stableRecords = Array.from(
        await admin`select * from app.records where owner_id=${f.actor.userId} order by id`,
      );
      const stablePrinciples = Array.from(
        await admin`select * from app.principles where owner_id=${f.actor.userId} order by id`,
      );
      // An archived source not yet copied into records is preserved by the final migration call.
      const lateId = crypto.randomUUID();
      const lateBody = "아직 이관되지 않은 근거 " + "😀".repeat(12000);
      await admin`insert into private.retired_principle_sources(owner_id,source_kind,source_id,title,summary,payload)
        values(${f.actor.userId},'principle',${lateId},'마지막 원본','이관 대기',${
        admin.json({ principle: { id: lateId, body: lateBody } })
      })`;
      const rolledBack = new Error("migration verification rollback");
      await assertRejects(
        () =>
          admin.begin(async (tx) => {
            await tx.unsafe(await Deno.readTextFile(migrationFile));
            for (
              const table of [
                "app.record_principles",
                "app.principle_tags",
                "app.legacy_principle_record_parts",
                "private.retired_principle_sources",
              ]
            ) {
              assertEquals((await tx`select to_regclass(${table}) as present`)[0].present, null);
            }
            assertEquals(
              (await tx`select to_regprocedure('private.preserve_principle_sources(uuid)') as present`)[0].present,
              null,
            );
            const afterRecords = Array.from(
              await tx`select * from app.records where owner_id=${f.actor.userId} and id in ${
                tx(stableRecords.map((r) => r.id))
              } order by id`,
            );
            assertEquals(afterRecords, stableRecords);
            assertEquals(
              Array.from(await tx`select * from app.principles where owner_id=${f.actor.userId} order by id`),
              stablePrinciples,
            );
            assertEquals((await tx`select id from app.records where id=${parts[0].id}`).length, 0);
            const lateParts =
              await tx`select body from app.records where owner_id=${f.actor.userId} and title like '원칙 보존 자료 · 마지막 원본%' order by title`;
            assertEquals(
              JSON.parse(lateParts.map((r) => r.body.split("\n\n").slice(1).join("\n\n")).join("")).principle.body,
              lateBody,
            );
            throw rolledBack;
          }),
        Error,
        rolledBack.message,
      );
      assertEquals((await activity.getRecord(ad, f.actor, oldEvent.id)).change, legacyChange);
      for (const part of parts.filter((r) => r.id !== parts[0].id && r.id !== parts[1].id)) {
        assertEquals((await activity.getRecord(ad, f.actor, part.id)).body, part.body);
      }
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  },
);

Deno.test({
  name: "close principle preservation DB clients",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await admin.end();
    await server.end();
  },
});
