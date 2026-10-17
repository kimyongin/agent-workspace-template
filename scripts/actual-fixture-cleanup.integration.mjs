import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { cleanupOwnedFixture } from "./actual-fixture-cleanup.mjs";
// Root executes this only against its isolated lease-controlled project.
test("owned fixture final cleanup preserves same-number other owner/baseline/Auth/settings and removes queue/receipts", async () => {
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
    modelKey = crypto.randomUUID(),
    modelId = crypto.randomUUID(),
    definitionId = crypto.randomUUID(),
    keptDefinition = crypto.randomUUID(),
    keptModel = crypto.randomUUID(),
    issuerKey = crypto.randomUUID(),
    ruleKey = crypto.randomUUID(),
    rule = crypto.randomUUID(),
    otherRule = crypto.randomUUID(),
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
      for (const [user, ruleId] of [[owner, rule], [other, otherRule]]) {
        await tx`insert into app.entity_issuers(owner_id,code,label,system) values(${user},'app','앱',true),(${user},'fixture','시험 발급처',false)`;
        await tx`insert into app.entity_identifier_rules(owner_id,id,source,label,meaning,generation) values(${user},'00000000-0000-4000-8000-000000000001','app','자동','앱 번호','automatic'),(${user},${ruleId},'fixture','번호','시험 번호','direct')`;
      }
      for (
        const [user, id] of [[owner, type], [owner, baseline], [
          other,
          otherType,
        ]]
      ) {
        await tx`insert into app.entity_types(owner_id,id) values(${user},${id})`;
        await tx`insert into app.entity_schema_versions(owner_id,schema) values(${user},${
          tx.json(fixtureSchema(id))
        })`;
      }
      for (
        const [user, id, source, ruleId] of [[owner, type, "fixture", rule], [
          other,
          otherType,
          "fixture",
          otherRule,
        ], [
          owner,
          baseline,
          "app",
          "00000000-0000-4000-8000-000000000001",
        ]]
      ) {
        await tx`insert into app.entity_type_identity(owner_id,type_id,label,default_source) values(${user},${id},'번호',${source})`;
        await tx`insert into app.entity_type_identity_sources(owner_id,type_id,code,rule_id) values(${user},${id},${source},${ruleId})`;
        const external = id === baseline ? "keep" : "same";
        await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${user},${`${source}:${id}:${external}`},${source},${external},${id},1,'{}')`;
      }
      await tx`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${owner},${`fixture:${type}:second`},'fixture','second',${type},1,'{}')`;
      for (
        const [user, definition, kind, model] of [[
          owner,
          definitionId,
          type,
          modelId,
        ], [other, keptDefinition, otherType, keptModel]]
      ) {
        await tx`insert into app.entity_relation_definitions(owner_id,id,left_type_id,left_label,left_cardinality,right_type_id,right_label,right_cardinality) values(${user},${definition},${kind},'구성','many',${kind},'소속','one')`;
        await tx`insert into app.data_model_changes(owner_id,id,status,plan) values(${user},${model},'ready','{}')`;
      }
      await tx`insert into app.entity_relation_links(owner_id,definition_id,left_entity_id,right_entity_id) values(${owner},${definitionId},${`fixture:${type}:same`},${`fixture:${type}:second`})`;
      const modelReceipt = {
        id: modelId,
        review: {
          mapping: { types: { fresh: type } },
          items: [{ ref: "fresh", kind: "new" }, {
            ref: `relation:${definitionId}`,
            kind: "new",
          }],
        },
      };
      await tx`insert into private.request_results(owner_id,request_key,operation,fingerprint,completed_at,result) values(${owner},${modelKey},'data-model.prepare',${
        "1".repeat(64)
      },now(),${tx.json(modelReceipt)})`;
      for (const [user, recordId] of [[owner, record], [other, otherRecord]]) {
        await tx`insert into app.records(owner_id,id,body,entity_ids) values(${user},${recordId},'fixture',array[${`fixture:${
          user === owner ? type : otherType
        }:same`}])`;
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
      await tx`insert into app.user_business_settings(owner_id,id,version,settings) values(${owner},'record_templates',1,${
        tx.json(settings)
      })`;
      await tx`insert into private.request_results(owner_id,request_key,operation,fingerprint,completed_at,result) values(${owner},${issuerKey},'issuer.create',${
        "1".repeat(64)
      },now(),' {"code":"fixture"}'::jsonb),(${owner},${ruleKey},'identifier-rule.create',${
        "1".repeat(64)
      },now(),${tx.json({ id: rule })})`;
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
        entity_issuers: ["fixture"],
        entity_identifier_rules: [rule],
      },
      requestKeys: [key, issuerKey, ruleKey, modelKey],
    };
    const reports = await cleanupOwnedFixture(databaseUrl, environment, scope);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].residual_rows, 0);
    assert.equal(reports[0].counts["app.entity_issuers"], 1);
    assert.equal(reports[0].counts["app.entity_identifier_rules"], 1);
    assert.equal(
      (await sql`select count(*)::int n from app.entity_issuers where owner_id=${other} and code='fixture'`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.entity_type_identity_sources where owner_id=${owner} and type_id=${type}`)[
        0
      ].n,
      0,
    );
    assert.equal(reports[0].counts["app.entities"], 2);
    assert.equal(reports[0].request_receipts, 4);
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
      (await sql`select count(*)::int n from app.entities where owner_id=${other} and id=${`fixture:${otherType}:same`}`)[
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
    assert.equal(reports[0].counts["app.entity_relation_definitions"], 1);
    assert.equal(reports[0].counts["app.entity_relation_links"], 1);
    assert.equal(reports[0].counts["app.data_model_changes"], 1);
    assert.equal(
      (await sql`select count(*)::int n from app.entity_relation_definitions where owner_id=${other} and id=${keptDefinition}`)[
        0
      ].n,
      1,
    );
    assert.equal(
      (await sql`select count(*)::int n from app.data_model_changes where owner_id=${other} and id=${keptModel}`)[
        0
      ].n,
      1,
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
      (await sql`select label from app.entity_issuers where owner_id=${owner} and code='app'`)[
        0
      ].label,
      "앱",
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

function fixtureSchema(typeId) {
  return {
    "x-type-id": typeId,
    "x-version": 1,
    title: "owned fixture",
    "x-icon": "box",
    deprecated: false,
    type: "object",
    additionalProperties: false,
    properties: {
      prop_1: {
        type: "string",
        title: "이름",
        "x-order": 1,
        "x-representative": true,
      },
    },
    required: ["prop_1"],
  };
}
