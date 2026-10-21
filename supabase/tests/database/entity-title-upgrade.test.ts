import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";

const baseline = await Deno.readTextFile(
  new URL("./fixtures/entity-title-before.sql", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20261021124707_entity_title_contract_cutover.sql",
    import.meta.url,
  ),
);
const workspace = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const type = "20000000-0000-4000-8000-000000000001";
const later = "20000000-0000-4000-8000-000000000002";
const id = "30000000-0000-4000-8000-000000000001";
const tables = [
  "app.entities",
  "app.records",
  "app.tasks",
  "app.entity_connections",
  "private.entity_search_jobs",
  "private.workspace_request_results",
  "app.entity_schema_changes",
  "app.entity_schema_analyses",
  "app.entity_schema_migrations",
  "app.data_model_changes",
];
function oldSchema(typeId = type, template?: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    "x-type-id": typeId,
    "x-version": 9,
    title: "보관 자료",
    "x-icon": "box",
    deprecated: typeId === later,
    type: "object",
    additionalProperties: false,
    ...(template ? { "x-title-template": template } : {}),
    properties: {
      prop_1: {
        type: "integer",
        "x-order": 20,
        minimum: 0,
        default: 0,
        readOnly: true,
        "x-show-in-list": true,
        "x-list-order": 2,
      },
      prop_2: {
        type: "string",
        title: "명칭",
        "x-order": 10,
        minLength: 1,
        "x-representative": true,
        "x-show-in-list": true,
        "x-list-order": 1,
        "x-search-text": true,
      },
      prop_3: {
        type: ["string", "null"],
        "x-order": 30,
        deprecated: true,
        oneOf: [{ const: "a", title: "선택" }, { const: null, title: "없음" }],
      },
    },
    required: ["prop_1", "prop_2"],
  };
}
const guards = [
  "type",
  "analysis:queued",
  "analysis:running",
  "change:analyzing",
  ...["queued", "preparing", "ready_to_commit", "committing"].map((s) =>
    `migration:${s}`
  ),
  ...["analyzing", "queued", "preparing", "ready_to_commit", "committing"].map((
    s,
  ) => `model:${s}`),
];
for (
  const scenario of [
    "empty",
    "populated",
    "size_boundary",
    "invalid_representative",
    "invalid_template",
    "size_limit",
    "version_limit",
    "late_insert_failure",
    ...guards,
  ]
) {
  dbTest(`title contract immutable forward cutover: ${scenario}`, async () => {
    const admin = connect(urls.admin, { max: 1 });
    const name = `title_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
    let sql: ReturnType<typeof connect> | undefined;
    try {
      await admin.unsafe(`create database "${name}" template template0`);
      const url = new URL(urls.admin);
      url.pathname = `/${name}`;
      sql = connect(url.href, { max: 1 });
      const db = sql;
      await db.unsafe(baseline);
      if (scenario !== "empty") {
        // Seed true pre-title documents before installing the permanent workspace anchor.
        const docs = [
          { scope: workspace, schema: oldSchema() },
          { scope: workspace, schema: oldSchema(later, "$prop_1$ / $prop_2$") },
          { scope: other, schema: oldSchema() },
          { scope: null, schema: oldSchema() },
        ];
        if (scenario === "invalid_representative") {
          delete (docs[1].schema.properties.prop_2 as Record<string, unknown>)[
            "x-representative"
          ];
        }
        if (scenario === "invalid_representative") {
          delete (docs[1].schema as Record<string, unknown>)[
            "x-title-template"
          ];
        }
        if (scenario === "invalid_template") {
          Object.assign(docs[1].schema, { "x-title-template": "$prop_999$" });
        }
        if (scenario === "version_limit") {
          docs[1].schema["x-version"] = 2147483647;
        }
        if (scenario === "size_limit" || scenario === "size_boundary") {
          docs[1].schema = oldSchema(later);
          // A valid source near its exact JSONB budget can overflow after adding root metadata.
          for (const f of Object.values(docs[1].schema.properties)) {
            delete (f as Record<string, unknown>)["x-show-in-list"];
            delete (f as Record<string, unknown>)["x-list-order"];
          }
        }
        await db.begin(async (tx) => {
          for (const doc of docs) {
            await tx`insert into app.entity_types(workspace_id,owner_id,id,schema_version) values(${doc.scope},${
              doc.scope ? null : id
            },${doc.schema["x-type-id"]},${doc.schema["x-version"]})`;
            if (
              ["size_limit", "size_boundary"].includes(scenario) &&
              doc.scope === workspace && doc.schema["x-type-id"] === later
            ) {
              const measured = scenario === "size_boundary"
                ? {
                  ...doc.schema,
                  "x-version": 10,
                  "x-title-template": "$prop_2$",
                  properties: Object.fromEntries(
                    Object.entries(doc.schema.properties).map((
                      [key, field],
                    ) => [
                      key,
                      Object.fromEntries(
                        Object.entries(field).filter(([name]) =>
                          name !== "x-representative"
                        ),
                      ),
                    ]),
                  ),
                }
                : doc.schema;
              const [{ bytes }] = await tx`select octet_length(jsonb_set(${
                tx.json(measured)
              },'{description}','""')::text)::int as bytes`;
              Object.assign(doc.schema, {
                description: "x".repeat(262144 - bytes),
              });
            }
            await tx`insert into app.entity_schema_versions(workspace_id,owner_id,schema) values(${doc.scope},${
              doc.scope ? null : id
            },${tx.json(doc.schema)})`;
          }
          await tx`insert into app.entities values(${workspace},${type},'retained',9,7,'{"prop_1":0,"prop_2":"原文","prop_3":null}')`;
          await tx`insert into app.records(workspace_id,id,body,entity_context,change_metadata) values(${workspace},${id},'old body','{"title":"captured"}','{"before":{"display_properties":[1]}}')`;
          await tx`insert into app.tasks(workspace_id,id,associations) values(${workspace},${id},'[{"title":"captured"}]')`;
          await tx`insert into app.entity_connections values(${workspace},${id},'{"identity":"original","tags":[1],"relations":[2]}')`;
          await tx`insert into private.entity_search_jobs values(${workspace},${id},'{"body":"unchanged","fence":7}')`;
          await tx`insert into private.workspace_request_results values(${id},${workspace},${id},'old-write',${
            "a".repeat(64)
          },'{"display_properties":[1]}',now()-interval '1 hour')`;
          for (
            const table of [
              "entity_schema_changes",
              "entity_schema_analyses",
              "entity_schema_migrations",
            ]
          ) {
            await tx.unsafe(
              `insert into app.${table} values($1,$2,'failed',$3)`,
              [
                workspace,
                id,
                JSON.stringify({
                  source_definition: docs[0].schema,
                  target: docs[1].schema,
                  fingerprint: "fixed",
                  expires_at: "2026-11-01T00:00:00Z",
                  reservations: { foo: "prop_99" },
                }),
              ],
            );
          }
          await tx`insert into app.data_model_changes values(${workspace},${id},'ready',${
            tx.json({
              target: docs[1].schema,
              baseline: "preserved",
              review: { fingerprint: "unchanged" },
            })
          })`;
        });
        if (scenario === "type") {
          await db`update app.entity_types set schema_write_locked=true where workspace_id=${workspace} and id=${type}`;
        }
        const [kind, status] = scenario.split(":");
        const target = {
          analysis: "entity_schema_analyses",
          change: "entity_schema_changes",
          migration: "entity_schema_migrations",
          model: "data_model_changes",
        }[kind];
        if (target) {
          await db.unsafe(`update app.${target} set status=$1`, [status]);
        }
      }
      await db.unsafe(
        `create trigger workspace_model_anchor before insert or update on app.entity_schema_versions for each row execute function private.guard_workspace_model_anchor()`,
      );
      if (scenario === "late_insert_failure") {
        await db.unsafe(
          `create function private.inject_failure() returns trigger language plpgsql as $$ begin if new.schema->>'x-type-id'='${later}' then raise exception 'injected_late_failure';end if;return new;end $$;create trigger zz_failure before insert on app.entity_schema_versions for each row execute function private.inject_failure()`,
        );
      }
      const oldVersions =
        await db`select * from app.entity_schema_versions order by workspace_id nulls last,type_id,schema_version`;
      const oldTypes =
        await db`select * from app.entity_types order by workspace_id nulls last,id`;
      const snapshots = await Promise.all(
        tables.map((table) =>
          db.unsafe(`select * from ${table} order by id`).catch(async () =>
            await db.unsafe(`select * from ${table} order by request_key`)
          )
        ),
      );
      const apply = async () => {
        try {
          await db.unsafe(migration);
        } catch (error) {
          await db.unsafe("rollback");
          throw error;
        }
      };
      const failing = !["empty", "populated", "size_boundary"].includes(
        scenario,
      );
      if (failing) {
        const error = await assertRejects(apply);
        const reason = (error as Error).message;
        assertEquals(
          reason.includes(
            scenario === "late_insert_failure"
              ? "injected_late_failure"
              : guards.includes(scenario)
              ? "entity_title_cutover_requires_quiescent_workers"
              : `entity_title_cutover_${scenario}`,
          ),
          true,
        );
        assertEquals(
          await db`select * from app.entity_schema_versions order by workspace_id nulls last,type_id,schema_version`,
          oldVersions,
        );
        assertEquals(
          await db`select * from app.entity_types order by workspace_id nulls last,id`,
          oldTypes,
        );
      } else {
        await apply();
        if (scenario === "populated" || scenario === "size_boundary") {
          const versions =
            await db`select * from app.entity_schema_versions order by workspace_id nulls last,type_id,schema_version`;
          assertEquals(
            versions.filter((r) => r.schema_version === 9),
            oldVersions,
          );
          assertEquals(versions.length, oldVersions.length + 3);
          if (scenario === "size_boundary") {
            assertEquals(
              (await db`select octet_length(schema::text)::int as bytes from app.entity_schema_versions where workspace_id=${workspace} and type_id=${later} and schema_version=10`)[
                0
              ].bytes,
              262144,
            );
          }
          const fresh = versions.filter((r) => r.schema_version === 10);
          for (const r of fresh) {
            assertEquals(
              r.schema["x-title-template"],
              r.type_id === later && scenario === "populated"
                ? "$prop_1$ / $prop_2$"
                : "$prop_2$",
            );
            const fields = r.schema.properties;
            for (
              const f of Object.values(fields) as Record<string, unknown>[]
            ) {
              assertEquals(
                ["x-representative", "x-show-in-list", "x-list-order"].some((
                  k,
                ) => k in f),
                false,
              );
            }
            assertEquals(fields.prop_1, {
              type: "integer",
              "x-order": 20,
              minimum: 0,
              default: 0,
              readOnly: true,
            });
            assertEquals(r.schema.required, ["prop_1", "prop_2"]);
          }
          assertEquals(
            (await db`select app.entity_title(schema,'{"prop_1":0,"prop_2":"資料"}','fallback') as title from app.entity_schema_versions where workspace_id=${workspace} and type_id=${type} and schema_version=10`)[
              0
            ].title,
            "資料",
          );
          await assertRejects(() =>
            db`update app.entity_schema_versions set schema=schema`
          );
          await db`select set_config('request.workspace_id',${workspace},false)`;
          for (
            const bad of [oldSchema(), {
              ...fresh[0].schema,
              "x-title-template": undefined,
            }]
          ) {
            await assertRejects(() =>
              db`insert into app.entity_schema_versions(workspace_id,schema) values(${workspace},${
                db.json({ ...bad, "x-version": 11 })
              })`
            );
          }
          await apply();
          assertEquals(
            await db`select * from app.entity_schema_versions order by workspace_id nulls last,type_id,schema_version`,
            versions,
          );
        }
      }
      for (const [index, table] of tables.entries()) {
        const rows = await db.unsafe(`select * from ${table} order by id`)
          .catch(async () =>
            await db.unsafe(`select * from ${table} order by request_key`)
          );
        assertEquals(rows, snapshots[index]);
      }
    } finally {
      await sql?.end();
      await admin.unsafe(`drop database if exists "${name}"`);
      await admin.end();
    }
  });
}
