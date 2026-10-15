import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, urls } from "./_db.ts";

const migration = await Deno.readTextFile(
  new URL("../../migrations/20261015180033_schema_document_storage.sql", import.meta.url),
);
const baseline = await Deno.readTextFile(new URL("./fixtures/schema-document-before.sql", import.meta.url));
const seed = await Deno.readTextFile(new URL("./fixtures/schema-document-seed.sql", import.meta.url));
const owner = "11111111-1111-4111-8111-111111111111";
const type = "22222222-2222-4222-8222-222222222222";
const request = "66666666-6666-4666-8666-666666666666";

for (const scenario of ["empty", "populated", "size_boundary", "large_legacy", "over_new_limit"]) {
  const populated = scenario !== "empty";
  dbTest(`schema document forward upgrade: ${scenario}`, async () => {
    const admin = connect(urls.admin, { max: 1 });
    const name = `schema_document_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
    let isolated: ReturnType<typeof connect> | undefined;
    let ownerConnection: ReturnType<typeof connect> | undefined;
    try {
      await admin.unsafe(`create database "${name}" template template0`);
      const url = new URL(urls.admin);
      url.pathname = `/${name}`;
      isolated = connect(url.href, { max: 1 });
      const sql = isolated;
      await sql.unsafe(baseline);
      const ownerUrl = new URL(urls.direct);
      ownerUrl.pathname = `/${name}`;
      ownerConnection = connect(ownerUrl.href, { max: 1 });
      const ownerSql = ownerConnection;
      if (populated) {
        await sql.unsafe(seed);
        await sql`insert into app.entities(owner_id,entity_type_id,schema_version,id,properties) values(${owner},${type},2,'preserved','{"prop_1":"saved","prop_2":"b"}')`;
      }
      if (scenario === "size_boundary") {
        await sql`alter table app.entity_schema_versions disable trigger immutable_entity_schema`;
        const values = Array.from({ length: 16 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(3998));
        await sql`update app.entity_schema_versions set schema=jsonb_set(schema,'{properties,prop_2,enum}',${
          sql.json([...values, null])
        }),display=jsonb_set(display,'{option_labels}','{}')`;
        await sql`update app.entity_schema_versions set schema=jsonb_set(schema,'{properties,prop_2,description}',to_jsonb(repeat('x',65536-octet_length(jsonb_set(schema,'{properties,prop_2,description}','""')::text)-octet_length(display::text))))`;
        await sql`alter table app.entity_schema_versions enable trigger immutable_entity_schema`;
        assertEquals(
          (await sql`select max(octet_length(schema::text)+octet_length(display::text))::int as bytes from app.entity_schema_versions`)[
            0
          ].bytes,
          65536,
        );
      }
      if (scenario === "large_legacy") {
        const properties: Record<string, unknown> = { prop_1: { type: "string", minLength: 1 } };
        for (let index = 2; index <= 64; index++) {
          properties[`prop_${index}`] = {
            type: "string",
            enum: Array.from({ length: 128 }, (_, value) => value === 0 ? "b" : String(value)),
          };
        }
        const schema = {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          properties,
          required: ["prop_1"],
        };
        const order = Object.keys(properties),
          display = {
            representative: "prop_1",
            order,
            list_columns: [...order].reverse(),
            archived: [],
            option_labels: {},
          };
        await sql`alter table app.entity_schema_versions disable trigger immutable_entity_schema`;
        await sql`update app.entity_schema_versions set schema=${sql.json(schema as never)},display=${
          sql.json(display)
        }`;
        // Fill the remaining legacy budget with valid <=1000-character field descriptions.
        for (const key of order) {
          const [{ remaining }] =
            await sql`select 65499-octet_length(schema::text)-octet_length(display::text)-19 as remaining from app.entity_schema_versions limit 1`;
          if (remaining <= 0) break;
          await sql`update app.entity_schema_versions set schema=jsonb_set(schema,${[
            "properties",
            key,
            "description",
          ]},to_jsonb(repeat('x',least(1000,${remaining}::int))))`;
        }
        await sql`alter table app.entity_schema_versions enable trigger immutable_entity_schema`;
      }
      if (scenario === "over_new_limit") {
        // Corrupt/out-of-policy legacy data must also fail before status or receipt changes.
        await sql`alter table app.entity_schema_versions disable trigger immutable_entity_schema`;
        await sql`alter table app.entity_schema_versions drop constraint entity_schema_definition_bytes,drop constraint entity_schema_versions_schema_check`;
        await sql`update app.entity_schema_versions set schema=jsonb_set(schema,'{properties,prop_2,description}',to_jsonb(repeat('x',262144)))`;
        await sql`alter table app.entity_schema_versions enable trigger immutable_entity_schema`;
      }
      const originalDocuments =
        await sql`select schema,display from app.entity_schema_versions order by schema_version`;
      const jobs =
        await sql`select id,source_definition,target,migration,fingerprint,result,source_expires_at from app.entity_schema_migrations order by id`;
      const requests = await sql`select * from private.request_results`;
      if (scenario === "over_new_limit") {
        const originals = await sql`select * from app.entity_schema_versions order by schema_version`;
        const states = await sql`select status,fence from app.entity_schema_migrations order by id`;
        const failure = await assertRejects(() => sql.begin((tx) => tx.unsafe(migration)));
        assertEquals((failure as { code?: string }).code, "54000");
        assertEquals((failure as Error).message.includes("schema_document_upgrade_size_limit"), true);
        assertEquals(await sql`select * from app.entity_schema_versions order by schema_version`, originals);
        assertEquals(await sql`select status,fence from app.entity_schema_migrations order by id`, states);
        assertEquals(await sql`select * from private.request_results`, requests);
        return;
      }
      await sql.begin((tx) => tx.unsafe(migration));
      const columns =
        await sql`select column_name,is_generated from information_schema.columns where table_schema='app' and table_name='entity_schema_versions' order by column_name`;
      assertEquals(columns.map((r) => [r.column_name, r.is_generated]), [
        ["created_at", "NEVER"],
        ["owner_id", "NEVER"],
        ["schema", "NEVER"],
        ["schema_version", "ALWAYS"],
        ["type_id", "ALWAYS"],
      ]);
      assertEquals(
        (await sql`select column_name from information_schema.columns where table_schema='app' and table_name='entity_types' and column_name in ('label','icon_id','archived','version')`)
          .length,
        0,
      );
      assertEquals(
        await sql`select id,source_definition,target,migration,fingerprint,result,source_expires_at from app.entity_schema_migrations order by id`,
        jobs,
      );
      assertEquals(await sql`select * from private.request_results`, requests);
      if (!populated) return;
      const versions = await asUser(
        ownerSql,
        owner,
        (tx) => tx`select schema_version,schema from app.entity_schema_versions order by schema_version`,
      );
      assertEquals(versions.map((v) => v.schema_version), [1, 2, 3]);
      assertEquals(versions[0].schema.title, undefined);
      assertEquals(versions[0].schema["x-icon"], undefined);
      assertEquals(versions[0].schema.deprecated, undefined);
      if (scenario === "size_boundary" || scenario === "large_legacy") {
        for (const row of versions.slice(0, 2)) {
          for (
            const [key, field] of Object.entries(originalDocuments[0].schema.properties) as Array<
              [string, { enum?: unknown[]; description?: string }]
            >
          ) {
            assertEquals(row.schema.properties[key].description, field.description);
            if (field.enum) {
              assertEquals(
                row.schema.properties[key].oneOf.map((choice: { const: unknown }) => choice.const),
                field.enum,
              );
            }
          }
        }
        const sizes = await sql`select octet_length(schema::text)::int as bytes from app.entity_schema_versions`;
        assertEquals(sizes.some((row) => row.bytes > 65536), true);
        assertEquals(sizes.every((row) => row.bytes <= 262144), true);
        return;
      }
      assertEquals(versions[0].schema.properties.prop_2.oneOf, [{ const: "b", title: "Beta" }, {
        const: "a",
        title: "Alpha",
      }, { const: null }]);
      assertEquals(versions[0].schema.properties.prop_1["x-order"], 1);
      assertEquals(versions[0].schema.properties.prop_1["x-list-order"], 2);
      assertEquals(versions[0].schema.properties.prop_2["x-list-order"], 1);
      assertEquals([
        versions[2].schema.title,
        versions[2].schema["x-icon"],
        versions[2].schema.deprecated,
        versions[2].schema["x-type-id"],
        versions[2].schema["x-version"],
      ], ["現在の名前", "star", false, type, 3]);
      assertEquals(
        (await sql`select schema_version,schema_write_locked,next_property_number from app.entity_types`)[0],
        { schema_version: 3, schema_write_locked: false, next_property_number: 3 },
      );
      assertEquals((await sql`select schema_version,properties from app.entities`)[0], {
        schema_version: 2,
        properties: { prop_1: "saved", prop_2: "b" },
      });
      assertEquals(
        (await sql`select status,fence::int as fence,retryable,failure_reason from app.entity_schema_migrations where id='55555555-5555-4555-8555-555555555555'`)[
          0
        ],
        { status: "failed", fence: 8, retryable: false, failure_reason: "schema_plan_stale" },
      );
      assertEquals(
        (await sql`select status,fence::int as fence from app.entity_schema_migrations where id='55555555-5555-4555-8555-555555555556'`)[
          0
        ],
        { status: "succeeded", fence: 7 },
      );
      assertEquals(
        (await sql`select app.commit_entity_schema_migration('55555555-5555-4555-8555-555555555555',7,'templates','test') as committed`)[
          0
        ].committed,
        false,
      );
      await assertRejects(() =>
        asUser(ownerSql, owner, (tx) => tx`update app.entity_schema_versions set schema='{}' where type_id=${type}`)
      );
      await assertRejects(() => sql`update app.entity_types set schema_version=99 where id=${type}`);
      await assertRejects(() =>
        asUser(
          ownerSql,
          owner,
          (tx) =>
            tx`insert into app.entity_schema_versions(owner_id,type_id,schema) values(${owner},${type},${
              tx.json(versions[2].schema)
            })`,
        )
      );
      await assertRejects(() =>
        asUser(
          ownerSql,
          owner,
          (tx) =>
            tx`insert into app.entity_schema_versions(owner_id,schema) values(${owner},${
              tx.json({ ...versions[2].schema, "x-type-id": crypto.randomUUID(), "x-version": 1 })
            })`,
        )
      );
      await assertRejects(() =>
        asUser(
          ownerSql,
          owner,
          (tx) =>
            tx`insert into app.entity_schema_versions(owner_id,schema) values(${owner},${
              tx.json({ ...versions[2].schema, "x-version": 3.5 })
            })`,
        )
      );
      await assertRejects(() =>
        asUser(
          ownerSql,
          owner,
          (tx) =>
            tx`insert into app.entity_schema_versions(owner_id,schema) values(${owner},${
              tx.json({ ...versions[2].schema, "x-version": "4" })
            })`,
        )
      );
      const other = crypto.randomUUID();
      await sql`insert into auth.users values(${other},'other@example.test')`;
      assertEquals(
        (await asUser(ownerSql, other, (tx) => tx`select schema from app.entity_schema_versions`)).length,
        0,
      );
      const replay = async (sub: string, key = request, fingerprint = "b".repeat(64)) =>
        (await asUser(
          ownerSql,
          sub,
          (tx) => tx`select app.replay_retained_request(${key},'entity_types.update',${fingerprint}) as value`,
        ))[0].value;
      assertEquals((await replay(owner)).state, "replay");
      assertEquals((await replay(owner)).result, requests[0].result);
      assertEquals((await replay(other)).state, "missing");
      assertEquals((await replay(owner, crypto.randomUUID())).state, "missing");
      assertEquals((await replay(owner, request, "a".repeat(64))).state, "idempotency_key_reused");
      assertEquals(await sql`select * from private.request_results`, requests);
      await sql`update private.request_results set completed_at=now()-interval '31 days'`;
      assertEquals((await replay(owner)).state, "result_expired");
      // Receipt expiry does not alter the independent 30-day value recovery material.
      assertEquals(
        await sql`select id,source_definition,target,migration,fingerprint,result,source_expires_at from app.entity_schema_migrations order by id`,
        jobs,
      );
    } finally {
      await ownerConnection?.end();
      await isolated?.end();
      await admin.unsafe(`drop database if exists "${name}"`);
      await admin.end();
    }
  });
}
