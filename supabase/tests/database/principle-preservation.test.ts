import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { principleCorrection } from "../../functions/_shared/contracts/principle.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as principle from "../../functions/_shared/core/principles/application.ts";
import { SqlSearchUnitOfWork } from "../../functions/_shared/adapters/supabase/search-store.ts";
import { searchInput } from "../../functions/_shared/contracts/search.ts";
import { search } from "../../functions/_shared/core/search/application.ts";

const admin = connect(urls.admin, { max: 1 });
const server = connect(urls.direct, { max: 1, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(server) },
  ad = { uow: new SqlUnitOfWork(server), clock: { now: () => new Date() } },
  pd = { uow: new SqlPrincipleUnitOfWork(server) };

dbTest(
  "통합 보존 dry-run: 긴 원칙·적용 원문·옛 사건·단일/다중/삭제 대상과 정정 재캡처의 손실·중복·권한을 지킨다",
  async () => {
    const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
    try {
      const first = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "이전 단일 대상" }));
      const second = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "삭제할 대상" }));
      const ids = [first.id, second.id].sort();
      const [legacyTask] = await admin`insert into app.tasks(owner_id,kind,title,summary,status,entity_id)
      values(${f.actor.userId},'once','옛 단일 업무','보존','open',${first.id}) returning id`;
      const multi = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ kind: "once", title: "여러 대상", summary: "보존", entity_ids: ids }),
      );
      const unlinked = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ kind: "once", title: "대상 없음", summary: "선택 사항" }),
      );
      const linkedRecord = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({ title: "당시 여러 대상", summary: "문맥", entity_ids: ids }),
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
      const snapshots = [{
        title: "당시 제목",
        summary: "당시 요약",
        body: "실제 적용 당시 본문",
        captured_at: "application",
      }];
      const [decision] =
        await admin`insert into app.records(owner_id,entity_id,title,summary,body,occurred_at,applied_principle_snapshots)
      values(${f.actor.userId},${first.id},'당시 판단','판단 요약','판단 내용','2021-02-03T00:00:00Z',${
          admin.json(snapshots)
        }) returning id`;
      await admin`insert into app.record_principles(owner_id,record_id,principle_id) values(${f.actor.userId},${decision.id},${source.id})`;
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
      assertEquals((await activity.getRecord(ad, f.actor, decision.id)).applied_principle_snapshots, snapshots);
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
      // A prior writer has retired this saved source; the supported legacy correction
      // changes its current content without rewriting earlier preservation chunks.
      await admin`update app.principles set is_current=false where id=${source.id}`;
      const original = await principle.getPrinciple(pd, f.actor, source.id);
      await principle.correctPrinciple(
        pd,
        f.actor,
        source.id,
        principleCorrection.parse({
          expected_version: original.version,
          body: "정정한 원칙 원문",
          change_note: "이전 원문 오류",
        }),
      );
      await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
      const hashes =
        await admin`select distinct source_hash from app.legacy_principle_record_parts where owner_id=${f.actor.userId} and source_kind='principle' and source_id=${source.id}`;
      assertEquals(hashes.length, 2);
      const oldHash = parts.find((r) => r.source_kind === "principle")!.source_hash;
      const revised =
        await admin`select r.body from app.legacy_principle_record_parts m join app.records r on r.id=m.record_id and r.owner_id=m.owner_id where m.owner_id=${f.actor.userId} and m.source_kind='principle' and m.source_id=${source.id} and m.source_hash<>${oldHash} order by m.part`;
      assertEquals(
        JSON.parse(revised.map((r) => r.body.split("\n\n", 2)[1]).join("")).principle.body,
        "정정한 원칙 원문",
      );
      const total =
        (await admin`select count(*)::int n from app.legacy_principle_record_parts where owner_id=${f.actor.userId}`)[0]
          .n;
      await admin`call private.preserve_principle_sources(${f.actor.userId}::uuid)`;
      assertEquals(
        (await admin`select count(*)::int n from app.legacy_principle_record_parts where owner_id=${f.actor.userId}`)[0]
          .n,
        total,
      );
      assertEquals((await activity.getRecord(ad, f.actor, oldEvent.id)).change, legacyChange);
      assertEquals((await principle.getPrinciple(pd, f.actor, source.id)).saved_at, "2020-01-02T00:00:00.000Z");
      for (const part of parts.filter((r) => r.id !== parts[0].id)) {
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
