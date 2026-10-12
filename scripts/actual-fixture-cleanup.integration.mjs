import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { cleanupOwnedFixture } from "./actual-fixture-cleanup.mjs";
// Root executes this only against its isolated lease-controlled project.
test("owned fixture final cleanup preserves same-ID other owner/baseline/Auth/settings and removes queue/receipts", async () => {
  const databaseUrl = process.env.LOCAL_DB_URL;
  assert.ok(databaseUrl, "LOCAL_DB_URL required");
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice() {} }),
    owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    type = crypto.randomUUID(),
    baseline = crypto.randomUUID(),
    otherType = crypto.randomUUID(),
    key = crypto.randomUUID(),
    record = `fixture-record-${crypto.randomUUID()}`,
    otherRecord = `fixture-record-${crypto.randomUUID()}`;
  const environment = {
    name: "isolated-fixture-integration",
    host: target.hostname,
    port: Number(target.port),
    database: decodeURIComponent(target.pathname.slice(1)),
  };
  const settings = {
    entity_types: {
      [type]: { update: { memo: "owned" } },
      [baseline]: { update: { memo: "keep" } },
    },
    task: { create: { memo: "keep" } },
  };
  try {
    await sql.begin(async (tx) => {
      await tx`insert into auth.users(id,email) values(${owner},${`fixture-${owner}@example.test`}),(${other},${`fixture-${other}@example.test`})`;
      for (
        const [user, id] of [[owner, type], [owner, baseline], [
          other,
          otherType,
        ]]
      ) {
        await tx`insert into app.entity_types(owner_id,id,label) values(${user},${id},'owned fixture')`;
        await tx`insert into app.entity_schema_versions(owner_id,type_id,schema_version,schema,display) values(${user},${id},1,'{}','{}')`;
      }
      for (
        const [user, id, entityId] of [[owner, type, "fixture:same"], [
          other,
          otherType,
          "fixture:same",
        ], [owner, baseline, "fixture:keep"]]
      ) {
        await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${user},${entityId},'fixture',${
          entityId.split(":")[1]
        },${id},1,'{}')`;
      }
      for (const [user, recordId] of [[owner, record], [other, otherRecord]]) {
        await tx`insert into app.records(owner_id,id,body,entity_ids) values(${user},${recordId},'fixture',array['fixture:same'])`;
        await tx`select pgmq.send('search_index'::text,${
          tx.json({ owner_id: user, kind: "record", id: recordId })
        }::jsonb)`;
        await tx`insert into app.search_index_state(owner_id,kind,id,input_hash,pipeline) values(${user},'record',${recordId},${
          "0".repeat(64)
        },'fixture')`;
        await tx`insert into private.request_results(owner_id,request_key,operation,fingerprint,completed_at,result) values(${user},${key},'entity-type.create',${
          "1".repeat(64)
        },now(),${tx.json({ id: user === owner ? type : otherType })})`;
      }
      await tx`insert into app.user_business_settings(owner_id,id,settings) values(${owner},'record_templates',${
        tx.json(settings)
      }),(${owner},'entity_identity','{"default_source":"keep"}')`;
    });
    const [auth] =
      await sql`select md5(jsonb_agg(to_jsonb(u) order by id)::text) digest from auth.users u where id=any(${[
        owner,
        other,
      ]}::uuid[])`;
    const scope = {
      ownerId: owner,
      ids: {
        entity_types: [type],
        entities: [],
        tasks: [],
        records: [],
        tags: [],
      },
      requestKeys: [key],
    };
    const reports = await cleanupOwnedFixture(databaseUrl, environment, scope);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].residual_rows, 0);
    assert.equal(reports[0].counts["app.entities"], 1);
    assert.equal(reports[0].request_receipts, 1);
    assert.equal(
      (await sql`select count(*)::int n from app.entity_types where owner_id=${owner}`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.entities where owner_id=${owner}`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.entities where owner_id=${other} and id='fixture:same'`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.records where owner_id=${other} and id=${otherRecord}`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from private.request_results where owner_id=${other} and request_key=${key}`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from pgmq.q_search_index where message->>'owner_id'=${owner}`)[
        0
      ].n,
      0,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.search_index_state where owner_id=${owner}`)[
        0
      ].n,
      0,
    );
    const [afterAuth] =
      await sql`select md5(jsonb_agg(to_jsonb(u) order by id)::text) digest from auth.users u where id=any(${[
        owner,
        other,
      ]}::uuid[])`;
    assert.equal(afterAuth.digest, auth.digest);
    assert.deepEqual(
      (await sql`select settings from app.user_business_settings where owner_id=${owner} and id='record_templates'`)[
        0
      ].settings,
      {
        entity_types: { [baseline]: { update: { memo: "keep" } } },
        task: { create: { memo: "keep" } },
      },
    );
    assert.deepEqual(
      (await sql`select settings from app.user_business_settings where owner_id=${owner} and id='entity_identity'`)[
        0
      ].settings,
      { default_source: "keep" },
    );
    assert.deepEqual(
      await cleanupOwnedFixture(databaseUrl, environment, scope),
      [],
    );
    const [stale] = await sql`select pgmq.send('search_index'::text,${
      sql.json({
        owner_id: owner,
        kind: "record",
        id: record,
        pipeline: "fixture",
        input_hash: "0".repeat(64),
      })
    }::jsonb) message`;
    assert.equal(
      (await sql`select app.prepare_search_index(${stale.message}::bigint,'fixture'::text) result`)[
        0
      ].result,
      null,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.records where owner_id=${owner} and id=${record}`)[
        0
      ].n,
      0,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.search_index_state where owner_id=${owner} and id=${record}`)[
        0
      ].n,
      0,
    );
  } finally {
    for (const user of [owner, other]) {
      await sql`delete from pgmq.q_search_index where message->>'owner_id'=${user}`;
      await sql`delete from pgmq.a_search_index where message->>'owner_id'=${user}`;
      await sql`delete from auth.users where id=${user}`;
    }
    await sql.end();
  }
});
