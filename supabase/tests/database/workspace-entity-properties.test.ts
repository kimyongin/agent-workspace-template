import { assertEquals } from "@std/assert";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as model from "../../functions/_shared/core/data-model/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import { entityCreate, entityListQuery } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 6, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) }, models = { uow: new SqlDataModelUnitOfWork(sql) };

dbTest(
  "workspace typed numeric cursors distinguish missing null and scalar values through current publication",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const kind = await f.createKind("수량 자료");
      await f.grantKind(f.manager, kind.id, "write");
      await f.grantKind(f.member, kind.id, "read");
      const document = await model.exportDataModel(models, f.manager);
      document.entity_types[0].schema.properties.prop_2 = {
        type: ["number", "null"],
        title: "수량",
        "x-order": 20,
      };
      const input = { mode: "update", document: JSON.stringify(document) };
      const preview = await model.previewDataModel(models, f.manager, input);
      assertEquals(preview.can_apply, true);
      const plan = await model.prepareDataModel(models, businessRequest(f.manager), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      assertEquals(
        (await model.applyDataModel(models, businessRequest(f.manager), plan.id, { expected_version: plan.version }))
          .status,
        "applied",
      );
      const schema = await types.getEntitySchema(f.typeDeps, f.manager, { type_id: kind.id });
      const values = [];
      for (
        const properties of [{ prop_1: "누락" }, { prop_1: "명시적 없음", prop_2: null }, { prop_1: "영", prop_2: 0 }, {
          prop_1: "둘",
          prop_2: 2,
        }]
      ) {
        values.push(
          await entities.createEntity(
            deps,
            businessRequest(f.manager),
            entityCreate.parse({ entity_type_id: kind.id, schema_version: schema.schema_version, properties }),
          ),
        );
      }
      for (const direction of ["asc", "desc"] as const) {
        const query = entityListQuery.parse({ entity_type_id: kind.id, sort: { key: "prop_2", direction }, limit: 1 });
        let page = await entities.listEntities(deps, f.member, query);
        const ids = page.items.map((row) => row.id);
        while (page.next_cursor) {
          page = await entities.listEntities(deps, f.member, { ...query, cursor: page.next_cursor });
          ids.push(...page.items.map((row) => row.id));
        }
        assertEquals(ids, direction === "asc" ? values.map((row) => row.id) : values.map((row) => row.id).reverse());
      }
      const filtered = await entities.listEntities(
        deps,
        f.member,
        entityListQuery.parse({
          entity_type_id: kind.id,
          filters: [{ key: "prop_2", operator: "gte", value: 0 }, { key: "prop_2", operator: "lte", value: 0 }],
        }),
      );
      assertEquals(filtered.items.map((row) => row.title), ["영"]);
      const unset = await entities.listEntities(
        deps,
        f.member,
        entityListQuery.parse({
          entity_type_id: kind.id,
          filters: [{ key: "prop_2", operator: "unset" }],
          sort: { key: "prop_2", direction: "asc" },
        }),
      );
      assertEquals(unset.items.map((row) => row.title), ["누락", "명시적 없음"]);
    } finally {
      await f.cleanup();
    }
  },
);
