import { SqlEntityIssuerStore } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import {
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import type { WorkspaceActor } from "../../functions/_shared/core/workspaces/application.ts";
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
// Administrative custom-schema/scale seeding is exact fixture setup, not RLS proof.
function seedInWorkspace<T>(actor: WorkspaceActor, run: (tx: postgres.TransactionSql) => Promise<T>) {
  return admin.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims',${
      JSON.stringify({ sub: actor.userId, role: "authenticated" })
    },true),
      set_config('request.workspace_id',${actor.workspaceId},true)`;
    return run(tx);
  });
}
async function typeFixture(actor: WorkspaceActor, label: string, numeric = true) {
  const definition = initialEntityDefinition("이름");
  Object.assign(definition.schema.properties, {
    prop_3: { "x-order": 30, type: numeric ? ["number", "null"] : "string", title: "값" },
    prop_4: { "x-order": 40, type: ["string", "null"], format: "date", title: "날짜" },
    prop_5: { "x-order": 50, type: ["boolean", "null"], title: "승인" },
    prop_6: { "x-order": 60, deprecated: true, type: "string", title: "옛 메모" },
  });
  return await seedInWorkspace(actor, async (tx) => {
    const [type] =
      await tx`insert into app.entity_types(workspace_id,next_property_number) values(${actor.workspaceId},7) returning id`;
    definition.schema["x-type-id"] = String(type.id);
    definition.schema.title = label;
    await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${actor.workspaceId},${
      tx.json(definition.schema as never)
    })`;
    await new SqlEntityIssuerStore(tx, actor).initializeRegistry();
    return { id: String(type.id), definition };
  });
}
dbTest(
  "typed list: scalar AND, missing/null order, stable ID ties, workspace/type/revision cursor isolation",
  async () => {
    const owner = await businessWorkspaceFixture(admin, sql), foreign = await businessWorkspaceFixture(admin, sql);
    try {
      const type = await typeFixture(owner.manager, "숫자 자료"),
        text = await typeFixture(owner.manager, "텍스트 자료", false),
        other = await typeFixture(foreign.manager, "타인 자료");
      const second = await owner.addWorkspace("같은 실행자의 다른 공간");
      const secondType = await typeFixture(second.manager, "다른 공간의 숫자 자료");
      await owner.grantKind(owner.manager, type.id, "write");
      await owner.grantKind(owner.manager, text.id, "write");
      await foreign.grantKind(foreign.manager, other.id, "write");
      await owner.grantKind(second.manager, secondType.id, "write");
      const values = [
        {},
        { prop_3: null, prop_4: null, prop_5: null },
        { prop_3: 0, prop_4: "2024-02-29", prop_5: false },
        { prop_3: 2, prop_4: "2025-01-01", prop_5: true },
        { prop_3: 2, prop_4: "2025-01-01", prop_5: false },
        { prop_3: 10, prop_4: "9999-12-31", prop_5: true },
      ];
      for (const [n, value] of values.entries()) {
        await seedInWorkspace(owner.manager, async (tx) => {
          await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties) values(${owner.workspaceId},${
            encodeIdentifierReference(type.id, APP_IDENTIFIER_RULE_ID, "order" + n)
          },${type.id},1,${
            tx.json({ prop_1: "行" + n, prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "order" + n), ...value })
          })`;
        });
      }
      for (
        const [actor, typeId, id, value] of [[owner.manager, text.id, "text", "bad numeric cast"], [
          foreign.manager,
          other.id,
          "foreign",
          2,
        ]] as const
      ) {
        await seedInWorkspace(actor, async (tx) => {
          await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties) values(${actor.workspaceId},${
            encodeIdentifierReference(typeId, APP_IDENTIFIER_RULE_ID, id)
          },${typeId},1,${
            tx.json({ prop_1: id, prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, id), prop_3: value })
          })`;
        });
      }
      let cursor = "";
      for (const direction of ["asc", "desc"] as const) {
        const query = entityListQuery.parse({ entity_type_id: type.id, sort: { key: "prop_3", direction }, limit: 1 });
        let page = await listEntities(d, owner.manager, query);
        cursor = page.next_cursor!;
        const ids = page.items.map((row) => row.id);
        while (page.next_cursor) {
          page = await listEntities(d, owner.manager, { ...query, cursor: page.next_cursor });
          ids.push(...page.items.map((row) => row.id));
        }
        assertEquals(
          ids,
          direction === "asc"
            ? [
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order0`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order1`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order2`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order3`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order4`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order5`,
            ]
            : [
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order5`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order4`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order3`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order2`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order1`,
              `${type.id}:${APP_IDENTIFIER_RULE_ID}:order0`,
            ],
        );
      }
      const query = entityListQuery.parse({
        entity_type_id: type.id,
        sort: { key: "prop_3", direction: "desc" },
        limit: 1,
      });
      for (
        const [actor, patch] of [[foreign.manager, { entity_type_id: other.id }], [second.manager, {
          entity_type_id: secondType.id,
        }], [
          owner.manager,
          { entity_type_id: text.id },
        ], [owner.manager, {
          filters: [{ key: "prop_5", operator: "eq", value: false }],
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
        owner.manager,
        entityListQuery.parse({
          entity_type_id: type.id,
          filters: [{ key: "prop_3", operator: "gte", value: 2 }, { key: "prop_3", operator: "lte", value: 2 }, {
            key: "prop_5",
            operator: "eq",
            value: false,
          }, { key: "prop_4", operator: "gte", value: "2024-02-29" }],
          sort: "title",
        }),
      );
      assertEquals(filtered.items.map((row) => row.id), [`${type.id}:${APP_IDENTIFIER_RULE_ID}:order4`]);
      assertEquals(
        (await listEntities(
          d,
          owner.manager,
          entityListQuery.parse({
            entity_type_id: type.id,
            filters: [{ key: "prop_3", operator: "unset" }],
            sort: "title",
          }),
        )).items.map((row) => row.id),
        [`${type.id}:${APP_IDENTIFIER_RULE_ID}:order0`, `${type.id}:${APP_IDENTIFIER_RULE_ID}:order1`],
      );
      for (const value of ["2", true, 1.0000001, 1e10]) {
        await assertRejects(() =>
          listEntities(
            d,
            owner.manager,
            entityListQuery.parse({ entity_type_id: type.id, filters: [{ key: "prop_3", operator: "eq", value }] }),
          ), AppError);
      }
      await assertRejects(
        () =>
          listEntities(
            d,
            owner.manager,
            entityListQuery.parse({
              entity_type_id: type.id,
              filters: [{ key: "prop_4", operator: "eq", value: "2025-02-29" }],
            }),
          ),
        AppError,
      );
      await seedInWorkspace(owner.manager, async (tx) => {
        await tx`insert into app.entity_schema_versions(workspace_id,schema) select workspace_id,schema||'{"x-version":2,"title":"새 이름"}'::jsonb from app.entity_schema_versions where workspace_id=${owner.workspaceId} and type_id=${type.id} and schema_version=1`;
        await tx`update app.entity_types set schema_version=2 where workspace_id=${owner.workspaceId} and id=${type.id}`;
      });
      assertEquals(
        (await assertRejects(() => listEntities(d, owner.manager, { ...query, cursor }), AppError)).code,
        "invalid_input",
      );
    } finally {
      await owner.cleanup();
      await foreign.cleanup();
    }
  },
);
dbTest(
  "type templates: current-schema refs and workspace binding; restore preview preserves omitted archived values",
  async () => {
    const owner = await businessWorkspaceFixture(admin, sql), foreign = await businessWorkspaceFixture(admin, sql);
    try {
      const type = await typeFixture(owner.manager, "재료"),
        other = await typeFixture(foreign.manager, "타인");
      await owner.grantKind(owner.manager, type.id, "write");
      await foreign.grantKind(foreign.manager, other.id, "write");
      const value = {
        entity_types: { [type.id]: { restore: { memo: "$엔터티.이후.prop_3$ / $엔터티.이후.prop_5$", tag_ids: [] } } },
      };
      await updateBusinessSettings(settings, requestActor(owner.manager), {
        id: "record_templates",
        expected_version: 0,
        value,
      });
      await seedInWorkspace(owner.manager, async (tx) => {
        await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties,deleted_at) values(${owner.workspaceId},${
          encodeIdentifierReference(type.id, APP_IDENTIFIER_RULE_ID, "restore")
        },${type.id},1,${
          tx.json({
            prop_1: "保管",
            prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "restore"),
            prop_3: 0,
            prop_5: false,
            prop_6: "原文",
          })
        },now())`;
      });
      const preview = await prepareBusinessRecord(settings, owner.manager, {
        model: "entity",
        action: "restore",
        target_id: encodeIdentifierReference(type.id, APP_IDENTIFIER_RULE_ID, "restore"),
        expected_version: 1,
        input: {
          schema_version: 1,
          expected_version: 1,
          properties: { prop_1: "保管", prop_3: 0, prop_5: false },
        },
      });
      assertEquals(preview.change_note, "0 / false");
      assertEquals(
        (await getEntity(d, owner.manager, encodeIdentifierReference(type.id, APP_IDENTIFIER_RULE_ID, "restore")))
          .properties.prop_6,
        "原文",
      );
      for (
        const next of [{ entity_types: { [other.id]: { create: { memo: "$대상$", tag_ids: [] } } } }, {
          entity_types: { [type.id]: { create: { memo: "$엔터티.이후.prop_6$", tag_ids: [] } } },
        }, { entity: { create: { memo: "$엔터티.이후.prop_3$", tag_ids: [] } } }]
      ) {
        await assertRejects(async () =>
          await updateBusinessSettings(settings, requestActor(owner.manager), {
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
  const owner = await businessWorkspaceFixture(admin, sql);
  try {
    const type = await typeFixture(owner.manager, "계획 검사");
    await owner.grantKind(owner.manager, type.id, "write");
    await seedInWorkspace(owner.manager, async (tx) => {
      await tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties) select ${owner.workspaceId}::uuid,${type.id}::text||':'||${APP_IDENTIFIER_RULE_ID}||':scale-'||n,${type.id}::uuid,1,jsonb_build_object('prop_1','자료 '||n,'prop_2',${APP_IDENTIFIER_RULE_ID}||':scale-'||n,'prop_3',n,'prop_5',false) from generate_series(1,2000) n`;
    });
    observed = null;
    const started = performance.now();
    const page = await listEntities(
      d,
      owner.manager,
      entityListQuery.parse({
        entity_type_id: type.id,
        filters: [{ key: "prop_3", operator: "gte", value: 1000 }],
        sort: { key: "prop_3", direction: "asc" },
        limit: 100,
      }),
    );
    const elapsed = performance.now() - started;
    assertEquals(page.items.length, 100);
    assertEquals(page.items[0].title, "자료 1000");
    assertEquals(page.items.at(-1)!.title, "자료 1099");
    assert(page.next_cursor);
    const captured = observed as { query: string; parameters: postgres.ParameterOrJSON<never>[] } | null;
    assert(captured);
    const rows = await runInWorkspace(
      sql,
      owner.manager,
      { mode: "business", requirements: [{ target_kind: "entity_type", target_id: type.id, access: "read" }] },
      (tx) => tx.unsafe("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + captured.query, captured.parameters),
    );
    const plan = rows[0]["QUERY PLAN"];
    assertEquals(plan[0].Plan["Node Type"], "Limit");
    assertEquals(plan[0].Plan["Actual Rows"], 101);
    console.log(
      "#350 actual 2000-row bounded list",
      JSON.stringify({ elapsed_ms: Math.round(elapsed), plan: rows[0]["QUERY PLAN"] }),
    );
  } finally {
    await owner.cleanup();
  }
});
