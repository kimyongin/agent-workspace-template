import { assertEquals, assertRejects } from "@std/assert";
import type postgres from "postgres";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as tag from "../../functions/_shared/core/tags/application.ts";
import * as principle from "../../functions/_shared/core/principles/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { principleCreate } from "../../functions/_shared/contracts/principle.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 });
const rootUrl = new URL(urls.admin);
rootUrl.username = "postgres";
rootUrl.password = "postgres";
const root = connect(rootUrl.toString(), { max: 1 });

// Exercise real adapters in one rollback transaction so the deterministic RNG never escapes the test.
async function deterministic(
  fn: (
    tx: postgres.TransactionSql,
    sql: postgres.Sql,
    owner: string,
    schema: { entity_type_id: string; schema_version: number },
  ) => Promise<void>,
) {
  const f = await fixtureOwner(admin), rollback = new Error("rollback deterministic RNG");
  try {
    const schema = await entityFixture(admin, f.actor.userId);
    await root.begin(async (tx) => {
      await tx`grant app_user to postgres`;
      await tx.unsafe(`create or replace function app.data_id_candidate() returns text language plpgsql volatile as $$
      declare n integer; begin
        n:=coalesce(nullif(current_setting('test.id_calls',true),''),'0')::integer;
        perform set_config('test.id_calls',(n+1)::text,true);
        return '20261011-'||lpad(case when current_setting('test.id_exhaust',true)='true' or n=0 then '0' else n::text end,8,'0');
      end $$`);
      const scoped = {
        begin: (run: (t: postgres.TransactionSql) => Promise<unknown>) => run(tx),
      } as unknown as postgres.Sql;
      await fn(tx, scoped, f.actor.userId, schema);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  } finally {
    await f.cleanup();
  }
}
async function reset(tx: postgres.TransactionSql) {
  await tx`reset role`;
  await tx`select set_config('test.id_calls','0',true),set_config('test.id_exhaust','false',true)`;
}
const actor = (owner: string) => ({ userId: owner, request: { key: crypto.randomUUID() } });

dbTest(
  "automatic creation retries only its PK collision across all models and replays the result",
  () =>
    deterministic(async (tx, sql, owner, schema) => {
      const collision = "20261011-00000000";
      await tx`insert into app.tags(id,owner_id,name,scope) values(${collision},${owner},'existing','task')`;
      await tx`insert into app.tasks(id,owner_id,kind,title,status) values(${collision},${owner},'once','existing','open')`;
      await tx`insert into app.records(id,owner_id,body) values(${collision},${owner},'existing')`;
      await tx`insert into app.principles(id,owner_id,title,body,is_current) values(${collision},${owner},'existing','',false)`;
      await tx`insert into app.entities(id,owner_id,source,external_id,entity_type_id,schema_version,properties)
        values(${`app:${schema.entity_type_id}:${collision}`},${owner},'app',${collision},${schema.entity_type_id},1,'{"prop_1":"existing"}'::jsonb)`;
      const ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
      const td = { uow: new SqlTagUnitOfWork(sql) }, pd = { uow: new SqlPrincipleUnitOfWork(sql) };
      const ed = { uow: new SqlEntityUnitOfWork(sql) };
      const writes = [
        (a: ReturnType<typeof actor>) => tag.createTag(td, a, { name: "new", scope: "task" }),
        (a: ReturnType<typeof actor>) => activity.createTask(ad, a, taskCreate.parse({ kind: "once", title: "new" })),
        (a: ReturnType<typeof actor>) => activity.createRecord(ad, a, recordCreate.parse({ body: "new" })),
        (a: ReturnType<typeof actor>) =>
          principle.createPrinciple(pd, a, principleCreate.parse({ title: "new", body: "" })),
        (a: ReturnType<typeof actor>) =>
          entity.createEntity(ed, a, entityCreate.parse({ ...schema, properties: { prop_1: "new" } })),
      ];
      for (const write of writes) {
        await reset(tx);
        const a = actor(owner), value = await write(a);
        assertEquals(
          value.id,
          value.id.startsWith("app:") ? `app:${schema.entity_type_id}:20261011-00000001` : "20261011-00000001",
        );
        assertEquals(await write(a), value);
      }
      const changes =
        await tx`select id,change_metadata from app.records where owner_id=${owner} and record_kind='change'`;
      assertEquals(changes.length, 3);
      for (const row of changes) assertEquals(row.change_metadata.event_id, row.id);
      await tx`reset role`;
      assertEquals((await tx`select to_regclass('private.data_id_reservations') value`)[0].value, null);
    }),
);

dbTest(
  "repeated PK collisions exhaust within a bound and roll back the request",
  () =>
    deterministic(async (tx, sql, owner) => {
      await tx`insert into app.tasks(id,owner_id,kind,title,status) values('20261011-00000000',${owner},'once','existing','open')`;
      await reset(tx);
      await tx`select set_config('test.id_exhaust','true',true)`;
      const a = actor(owner), input = taskCreate.parse({ kind: "once", title: "new" });
      await tx.savepoint(async (attempt) => {
        const nested = {
          begin: (run: (t: postgres.TransactionSql) => Promise<unknown>) => run(attempt),
        } as unknown as postgres.Sql;
        const error = await assertRejects(
          () => activity.createTask({ uow: new SqlUnitOfWork(nested), clock: { now: () => new Date() } }, a, input),
          AppError,
        );
        assertEquals(error.code, "unavailable");
        assertEquals(Number((await attempt`select current_setting('test.id_calls') n`)[0].n), 64);
        throw error;
      }).catch((e) => {
        if (!(e instanceof AppError) || e.code !== "unavailable") throw e;
      });
      await tx`reset role`;
      assertEquals((await tx`select count(*)::int n from private.request_results where owner_id=${owner}`)[0].n, 0);
      assertEquals((await tx`select count(*)::int n from app.records where owner_id=${owner}`)[0].n, 0);
      await reset(tx);
      const value = await activity.createTask(
        { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
        a,
        input,
      );
      assertEquals(value.id, "20261011-00000001");
    }),
);

dbTest(
  "business uniqueness and explicit external identifiers are not silently regenerated",
  () =>
    deterministic(async (tx, _sql, owner, schema) => {
      await tx`insert into app.tags(id,owner_id,name,scope) values('20261011-00000000',${owner},'duplicate','task')`;
      await tx`insert into app.entities(id,owner_id,source,external_id,entity_type_id,schema_version,properties)
        values(${`app:${schema.entity_type_id}:explicit`},${owner},'app','explicit',${schema.entity_type_id},1,'{"prop_1":"existing"}'::jsonb)`;
      const writes = [
        (connection: postgres.Sql) =>
          tag.createTag({ uow: new SqlTagUnitOfWork(connection) }, actor(owner), { name: "duplicate", scope: "task" }),
        (connection: postgres.Sql) =>
          entity.createEntity(
            { uow: new SqlEntityUnitOfWork(connection) },
            actor(owner),
            entityCreate.parse({ ...schema, external_id: "explicit", properties: { prop_1: "new" } }),
          ),
      ];
      for (const write of writes) {
        await reset(tx);
        await tx.savepoint(async (attempt) => {
          const connection = {
            begin: (run: (t: postgres.TransactionSql) => Promise<unknown>) => run(attempt),
          } as unknown as postgres.Sql;
          const error = await assertRejects(() => write(connection), AppError);
          assertEquals(error.code, "conflict");
          throw error;
        }).catch((e) => {
          if (!(e instanceof AppError) || e.code !== "conflict") throw e;
        });
      }
      await tx`reset role`;
      assertEquals((await tx`select count(*)::int n from private.request_results where owner_id=${owner}`)[0].n, 0);
      assertEquals((await tx`select count(*)::int n from app.entities where owner_id=${owner}`)[0].n, 1);
      assertEquals((await tx`select count(*)::int n from app.tags where owner_id=${owner}`)[0].n, 1);
    }),
);

dbTest(
  "a deleted generated ID may be used again while the earlier request still replays",
  () =>
    deterministic(async (tx, sql, owner) => {
      const deps = { uow: new SqlTagUnitOfWork(sql) }, first = actor(owner);
      await reset(tx);
      const old = await tag.createTag(deps, first, { name: "old", scope: "task" });
      await tag.deleteTag(deps, actor(owner), old.id, old.version);
      await reset(tx);
      const fresh = await tag.createTag(deps, actor(owner), { name: "new", scope: "task" });
      assertEquals(fresh.id, old.id);
      assertEquals(fresh.name, "new");
      assertEquals(await tag.createTag(deps, first, { name: "old", scope: "task" }), old);
      assertEquals((await tx`select name from app.tags where id=${fresh.id}`)[0].name, "new");
    }),
);
