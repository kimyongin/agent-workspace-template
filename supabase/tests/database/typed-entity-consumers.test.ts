import { SqlEntityIssuerStore } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { entityListQuery } from "../../functions/_shared/contracts/entity.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { getEntity, listEntities } from "../../functions/_shared/core/entity/application.ts";
import { prepareBusinessRecord, updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type postgres from "postgres";
const admin = connect(urls.admin, { max: 1 });
let observed: { query: string; parameters: postgres.ParameterOrJSON<never>[] } | null = null;
const sql = connect(urls.pooler, {
  prepare: false,
  max: 3,
  debug: (_connection, query, parameters) => {
    if (query.includes(" as sort_category")) observed = { query, parameters };
  },
});
const d = { uow: new SqlEntityUnitOfWork(sql) },
  settings = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: { now: () => new Date() } };
async function typeFixture(owner: string, label: string, numeric = true) {
  const definition = initialEntityDefinition("이름");
  Object.assign(definition.schema.properties, {
    prop_2: { "x-order": 20, "x-show-in-list": true, type: numeric ? ["number", "null"] : "string", title: "값" },
    prop_3: { "x-order": 30, type: ["string", "null"], format: "date", title: "날짜" },
    prop_4: { "x-order": 40, "x-show-in-list": true, type: ["boolean", "null"], title: "승인" },
    prop_5: { "x-order": 50, deprecated: true, type: "string", title: "옛 메모" },
  });
  return await admin.begin(async (tx) => {
    const [type] =
      await tx`insert into app.entity_types(owner_id,next_property_number) values(${owner},6) returning id`;
    definition.schema["x-type-id"] = String(type.id);
    definition.schema.title = label;
    await tx`insert into app.entity_schema_versions(owner_id,schema) values(${owner},${
      tx.json(definition.schema as never)
    })`;
    await new SqlEntityIssuerStore(tx, { userId: owner }).initializeTypeIdentity(type.id);
    return { id: String(type.id), definition };
  });
}
dbTest("typed list: scalar AND, missing/null order, stable ID ties, owner/type/revision cursor isolation", async () => {
  const owner = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
  try {
    const type = await typeFixture(owner.actor.userId, "숫자 자료"),
      text = await typeFixture(owner.actor.userId, "텍스트 자료", false),
      other = await typeFixture(foreign.actor.userId, "타인 자료");
    const values = [
      {},
      { prop_2: null, prop_3: null, prop_4: null },
      { prop_2: 0, prop_3: "2024-02-29", prop_4: false },
      { prop_2: 2, prop_3: "2025-01-01", prop_4: true },
      { prop_2: 2, prop_3: "2025-01-01", prop_4: false },
      { prop_2: 10, prop_3: "9999-12-31", prop_4: true },
    ];
    for (const [n, value] of values.entries()) {
      await admin`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${owner.actor.userId},${
        `app:${type.id}:order` + n
      },'app',${"order" + n},${type.id},1,${admin.json({ prop_1: "行" + n, ...value })})`;
    }
    for (
      const [ownerId, typeId, id, value] of [[owner.actor.userId, text.id, "text", "bad numeric cast"], [
        foreign.actor.userId,
        other.id,
        "foreign",
        2,
      ]] as const
    ) {
      await admin`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) values(${ownerId},${
        `app:${typeId}:` + id
      },'app',${id},${typeId},1,${admin.json({ prop_1: id, prop_2: value })})`;
    }
    let cursor = "";
    for (const direction of ["asc", "desc"] as const) {
      const query = entityListQuery.parse({ entity_type_id: type.id, sort: { key: "prop_2", direction }, limit: 1 });
      let page = await listEntities(d, owner.actor, query);
      cursor = page.next_cursor!;
      const ids = page.items.map((row) => row.id);
      while (page.next_cursor) {
        page = await listEntities(d, owner.actor, { ...query, cursor: page.next_cursor });
        ids.push(...page.items.map((row) => row.id));
      }
      assertEquals(
        ids,
        direction === "asc"
          ? [
            `app:${type.id}:order0`,
            `app:${type.id}:order1`,
            `app:${type.id}:order2`,
            `app:${type.id}:order3`,
            `app:${type.id}:order4`,
            `app:${type.id}:order5`,
          ]
          : [
            `app:${type.id}:order5`,
            `app:${type.id}:order4`,
            `app:${type.id}:order3`,
            `app:${type.id}:order2`,
            `app:${type.id}:order1`,
            `app:${type.id}:order0`,
          ],
      );
    }
    const query = entityListQuery.parse({
      entity_type_id: type.id,
      sort: { key: "prop_2", direction: "desc" },
      limit: 1,
    });
    for (
      const [actor, patch] of [[foreign.actor, {}], [owner.actor, { entity_type_id: text.id }], [owner.actor, {
        filters: [{ key: "prop_4", operator: "eq", value: false }],
      }]] as const
    ) {
      assertEquals(
        (await assertRejects(
          () => listEntities(d, actor, entityListQuery.parse({ ...query, ...patch, cursor })),
          AppError,
        )).code,
        "invalid_input",
      );
    }
    const filtered = await listEntities(
      d,
      owner.actor,
      entityListQuery.parse({
        entity_type_id: type.id,
        filters: [{ key: "prop_2", operator: "gte", value: 2 }, { key: "prop_2", operator: "lte", value: 2 }, {
          key: "prop_4",
          operator: "eq",
          value: false,
        }, { key: "prop_3", operator: "gte", value: "2024-02-29" }],
        sort: "title",
      }),
    );
    assertEquals(filtered.items.map((row) => row.id), [`app:${type.id}:order4`]);
    assertEquals(
      (await listEntities(
        d,
        owner.actor,
        entityListQuery.parse({
          entity_type_id: type.id,
          filters: [{ key: "prop_2", operator: "unset" }],
          sort: "title",
        }),
      )).items.map((row) => row.id),
      [`app:${type.id}:order0`, `app:${type.id}:order1`],
    );
    for (const value of ["2", true, 1.0000001, 1e10]) {
      await assertRejects(() =>
        listEntities(
          d,
          owner.actor,
          entityListQuery.parse({ entity_type_id: type.id, filters: [{ key: "prop_2", operator: "eq", value }] }),
        ), AppError);
    }
    await assertRejects(
      () =>
        listEntities(
          d,
          owner.actor,
          entityListQuery.parse({
            entity_type_id: type.id,
            filters: [{ key: "prop_3", operator: "eq", value: "2025-02-29" }],
          }),
        ),
      AppError,
    );
    await admin.begin(async (tx) => {
      await tx`insert into app.entity_schema_versions(owner_id,schema) select owner_id,schema||'{"x-version":2,"title":"새 이름"}'::jsonb from app.entity_schema_versions where type_id=${type.id} and schema_version=1`;
      await tx`update app.entity_types set schema_version=2 where id=${type.id}`;
    });
    assertEquals(
      (await assertRejects(() => listEntities(d, owner.actor, { ...query, cursor }), AppError)).code,
      "invalid_input",
    );
  } finally {
    await owner.cleanup();
    await foreign.cleanup();
  }
});
dbTest(
  "type templates: current-schema refs and owner binding; restore preview preserves omitted archived values",
  async () => {
    const owner = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
    try {
      const type = await typeFixture(owner.actor.userId, "재료"),
        other = await typeFixture(foreign.actor.userId, "타인");
      const value = {
        entity_types: { [type.id]: { restore: { memo: "$엔터티.이후.prop_2$ / $엔터티.이후.prop_4$", tag_ids: [] } } },
      };
      await updateBusinessSettings(settings, requestActor(owner.actor), {
        id: "record_templates",
        expected_version: 0,
        value,
      });
      await admin`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties,deleted_at) values(${owner.actor.userId},${`app:${type.id}:restore`},'app','restore',${type.id},1,${
        admin.json({ prop_1: "保管", prop_2: 0, prop_4: false, prop_5: "原文" })
      },now())`;
      const preview = await prepareBusinessRecord(settings, owner.actor, {
        model: "entity",
        action: "restore",
        target_id: `app:${type.id}:restore`,
        expected_version: 1,
        input: {
          entity_type_id: type.id,
          schema_version: 1,
          source: "app",
          external_id: "restore",
          properties: { prop_1: "保管", prop_2: 0, prop_4: false },
        },
      });
      assertEquals(preview.change_note, "0 / false");
      assertEquals((await getEntity(d, owner.actor, `app:${type.id}:restore`)).properties.prop_5, "原文");
      for (
        const next of [{ entity_types: { [other.id]: { create: { memo: "$대상$", tag_ids: [] } } } }, {
          entity_types: { [type.id]: { create: { memo: "$엔터티.이후.prop_5$", tag_ids: [] } } },
        }, { entity: { create: { memo: "$엔터티.이후.prop_2$", tag_ids: [] } } }]
      ) {
        await assertRejects(async () =>
          await updateBusinessSettings(settings, requestActor(owner.actor), {
            id: "record_templates",
            expected_version: 1,
            value: next,
          }), AppError);
      }
    } finally {
      await owner.cleanup();
      await foreign.cleanup();
    }
  },
);
dbTest("typed list scale: 2000 rows use the actual bounded joined query plan", async () => {
  const owner = await fixtureOwner(admin);
  try {
    const type = await typeFixture(owner.actor.userId, "계획 검사");
    await admin`insert into app.entities(owner_id,id,source,external_id,entity_type_id,schema_version,properties) select ${owner.actor.userId}::uuid,'app:'||${type.id}::text||':scale-'||n,'app','scale-'||n,${type.id}::uuid,1,jsonb_build_object('prop_1','자료 '||n,'prop_2',n,'prop_4',false) from generate_series(1,2000) n`;
    observed = null;
    const started = performance.now();
    const page = await listEntities(
      d,
      owner.actor,
      entityListQuery.parse({
        entity_type_id: type.id,
        filters: [{ key: "prop_2", operator: "gte", value: 1000 }],
        sort: { key: "prop_2", direction: "asc" },
        limit: 100,
      }),
    );
    const elapsed = performance.now() - started;
    assertEquals(page.items.length, 100);
    assertEquals(page.items[0].display_properties.prop_2, 1000);
    assertEquals(page.items.at(-1)!.display_properties.prop_2, 1099);
    assert(page.next_cursor);
    const captured = observed as { query: string; parameters: postgres.ParameterOrJSON<never>[] } | null;
    assert(captured);
    const rows = await asUser(
      sql,
      owner.actor.userId,
      (tx) => tx.unsafe("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + captured.query, captured.parameters),
    );
    console.log(
      "#350 actual 2000-row bounded list",
      JSON.stringify({ elapsed_ms: Math.round(elapsed), plan: rows[0]["QUERY PLAN"] }),
    );
  } finally {
    await owner.cleanup();
  }
});
