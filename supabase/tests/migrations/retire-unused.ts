// prepare on the predecessor schema, apply the forward migration, then verify.
// No resets, service operations or external calls. Only this fixture's owner is removed.
import { assert, assertEquals, assertRejects } from "@std/assert";
import postgres from "postgres";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as principles from "../../functions/_shared/core/principles/application.ts";
import { principleSave } from "../../functions/_shared/contracts/principle.ts";

const url = Deno.env.get("LOCAL_DB_URL")!;
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55622") throw Error("Requires owned isolated DB55622");
const [stage, file] = Deno.args;
if (!["prepare", "verify"].includes(stage) || !file) throw Error("prepare|verify <owned-fixture-json>");
const sql = postgres(url, { max: 1, onnotice: () => {} });
let direct: postgres.Sql | undefined;
try {
  if (stage === "prepare") {
    const f = {
      owner: crypto.randomUUID(),
      entity: crypto.randomUUID(),
      task: crypto.randomUUID(),
      record: crypto.randomUUID(),
      principle: crypto.randomUUID(),
    };
    await sql.begin(async (tx) => {
      await tx`insert into auth.users(id,email) values(${f.owner},${`retirement-${f.owner}@fixture.invalid`})`;
      await tx`insert into app.entities(id,owner_id,prop1) values(${f.entity},${f.owner},'옛 대상')`;
      await tx`insert into app.tasks(id,owner_id,kind,status,title,summary,entity_id) values(${f.task},${f.owner},'once','open','옛 업무','단일 대상',${f.entity})`;
      await tx`insert into app.principles(id,owner_id,title,summary,body,entity_id,applies_when,status,is_current,saved_at)
        values(${f.principle},${f.owner},'당시 기준','완전한 근거',${
        "😀".repeat(19000)
      },${f.entity},'옛 적용 조건','inactive',true,'2020-01-02T00:00:00Z')`;
      const snapshot = [{
        id: f.principle,
        title: "당시 제목",
        summary: "당시 요약",
        body: "실제 적용 원문",
        version: 1,
        saved_at: "2020-01-02T00:00:00.000Z",
        status: "active",
        captured_at: "application",
      }];
      await tx`insert into app.records(id,owner_id,title,summary,body,entity_id,applied_principle_snapshots,occurred_at)
        values(${f.record},${f.owner},'옛 판단','요약','판단 메모',${f.entity},${
        tx.json(snapshot)
      },'2021-02-03T00:00:00Z')`;
      await tx`insert into app.record_principles(owner_id,record_id,principle_id) values(${f.owner},${f.record},${f.principle})`;
      await tx`call private.preserve_principle_sources(${f.owner}::uuid)`;
    });
    const sources =
      await sql`select source_kind,source_id,source_hash,part,record_id,captured_at from app.legacy_principle_record_parts where owner_id=${f.owner} order by source_kind,part`;
    await Deno.writeTextFile(
      file,
      JSON.stringify({
        ...f,
        sources,
        snapshot: (await sql`select applied_principle_snapshots from app.records where id=${f.record}`)[0]
          .applied_principle_snapshots,
      }),
    );
    console.log("Prepared owned pre-DDL sources and existing preservation parts");
  } else {
    const f = JSON.parse(await Deno.readTextFile(file));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !f || ![f.owner, f.entity, f.task, f.record, f.principle].every((id) =>
        typeof id === "string" && uuid.test(id)
      ) ||
      !Array.isArray(f.sources) || !Array.isArray(f.snapshot)
    ) throw Error("Invalid owned cutoff fixture");
    const owned =
      await sql`select id from auth.users where id=${f.owner} and email=${`retirement-${f.owner}@fixture.invalid`}`;
    if (owned.length !== 1) throw Error("Owned cutoff fixture account not found");
    try {
      const password = Deno.env.get("APP_SERVER_PASSWORD");
      if (!password) throw Error("APP_SERVER_PASSWORD is required for business-role verification");
      direct = postgres(
        `postgresql://app_server:${encodeURIComponent(password)}@${parsed.hostname}:${parsed.port}/postgres`,
        { max: 1, onnotice: () => {} },
      );
      const source =
        (await sql`select payload from private.retired_principle_sources where owner_id=${f.owner} and source_kind='principle'`)[
          0
        ].payload.principle;
      assertEquals([source.entity_id, source.applies_when, source.status, source.saved_at], [
        f.entity,
        "옛 적용 조건",
        "inactive",
        "2020-01-02T00:00:00+00:00",
      ]);
      assertEquals(source.body, "😀".repeat(19000));
      const parts = async () =>
        JSON.parse(
          JSON.stringify(
            await sql`select source_kind,source_id,source_hash,part,record_id,captured_at from app.legacy_principle_record_parts where owner_id=${f.owner} order by source_kind,part`,
          ),
        );
      assertEquals(await parts(), f.sources);
      const originalBodies = await sql`select id,body from app.records where owner_id=${f.owner} order by id`;
      const asOwner = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
        direct!.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims',${
            JSON.stringify({ sub: f.owner, role: "authenticated" })
          },true)`;
          await tx`set local role app_user`;
          return await fn(tx);
        });
      const ad = { uow: new SqlUnitOfWork(direct), clock: { now: () => new Date() } },
        pd = { uow: new SqlPrincipleUnitOfWork(direct) },
        actor = { userId: f.owner };
      assertEquals((await activity.getTask(ad, actor, f.task)).entity_ids, [f.entity]);
      assertEquals((await activity.getRecord(ad, actor, f.record)).applied_principle_snapshots, f.snapshot);
      for (const kind of ["principle", "record_principle_context"]) {
        const mapped = f.sources.filter((r: { source_kind: string }) => r.source_kind === kind);
        const chunks: string[] = [];
        for (const part of mapped) {
          const record = await activity.getRecord(ad, actor, part.record_id);
          assertEquals(record.record_kind, "user");
          chunks.push(record.body!.split("\n\n").slice(1).join("\n\n"));
        }
        const preserved = JSON.parse(chunks.join(""));
        if (kind === "principle") assertEquals(preserved.principle, source);
        else assertEquals(preserved.applied_principle_snapshots, f.snapshot);
      }
      const old = await principles.getPrinciple(pd, actor, f.principle);
      await principles.saveCurrentPrinciple(
        pd,
        actor,
        principleSave.parse({
          title: old.title,
          summary: old.summary,
          body: "현재 문서 편집",
          expected_version: old.version,
        }),
      );
      await sql`call private.preserve_principle_sources(${f.owner}::uuid)`;
      assertEquals(await parts(), f.sources);
      assertEquals(
        await sql`select id,body from app.records where owner_id=${f.owner} and id in ${
          sql(originalBodies.map((r) => r.id))
        } order by id`,
        originalBodies,
      );
      assertEquals(
        (await sql`select payload from private.retired_principle_sources where owner_id=${f.owner} and source_kind='principle'`)[
          0
        ].payload.principle,
        source,
      );
      await assertRejects(() => asOwner((tx) => tx`call private.preserve_principle_sources(${f.owner}::uuid)`));
      await assertRejects(() =>
        asOwner((tx) => tx`update app.records set applied_principle_snapshots='[]'::jsonb where id=${f.record}`)
      );
      await assertRejects(() =>
        asOwner((tx) => tx`insert into app.record_principles values(${f.owner},${f.record},${f.principle})`)
      );
      const columns =
        await sql`select table_name,column_name from information_schema.columns where table_schema='app' and (table_name in ('tasks','records') and column_name='entity_id' or table_name='principles' and column_name in ('entity_id','applies_when','status','replaced_by_id'))`;
      assertEquals(columns.length, 0);
      assert((await activity.getRecord(ad, actor, f.record)).body === "판단 메모");
      console.log(
        "Retirement cutoff PASS: complete pre-DDL sources, exact snapshots/parts, stable rerun after edit, retired writes denied",
      );
    } finally {
      await sql`delete from auth.users where id=${f.owner} and email=${`retirement-${f.owner}@fixture.invalid`}`;
    }
  }
} finally {
  await direct?.end();
  await sql.end();
}
