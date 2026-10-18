import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { createEntityType, getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import {
  analyzeEntitySchemaChange,
  applyEntitySchemaChange,
  createEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { createEntity, updateEntity } from "../../functions/_shared/core/entity/application.ts";
import type { EntityProperties } from "../../functions/_shared/contracts/entity.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

dbTest(
  "document field annotations: readonly server defaults, deprecated input, examples and exact numeric multiples",
  async () => {
    const admin = connect(urls.admin), sql = connect(urls.direct), owner = await businessWorkspaceFixture(admin, sql);
    const types = { uow: new SqlEntityTypeUnitOfWork(sql) }, entities = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createEntityType(types, requestActor(owner.manager), { label: "문서 속성 의미" });
      await owner.grantKind(owner.manager, type.id, "write");
      const draft = await createEntitySchemaChange(types, requestActor(owner.manager), type.id, {
        expected_schema_version: 1,
        edits: [
          {
            op: "add_property",
            client_ref: "server",
            field: { type: "integer", "x-order": 20, readOnly: true, default: 7 },
          },
          { op: "add_property", client_ref: "number", field: { type: "number", "x-order": 30, multipleOf: 0.25 } },
          { op: "add_property", client_ref: "guide", field: { type: "string", "x-order": 40, examples: ["안내값"] } },
          {
            op: "add_property",
            client_ref: "retired",
            field: { type: "string", "x-order": 50, deprecated: true, default: "자동 입력 금지" },
          },
        ],
      });
      const analysis = await analyzeEntitySchemaChange(types, requestActor(owner.manager), type.id, draft.id, {
        expected_change_version: draft.version,
      });
      await applyEntitySchemaChange(types, requestActor(owner.manager), type.id, draft.id, {
        expected_change_version: draft.version,
        analysis_id: analysis.analysis_id,
      });
      const schema = await getEntitySchema(types, owner.manager, { type_id: type.id });
      assertEquals(schema.schema["x-version"], 2);
      assertEquals(schema.schema.properties.prop_3.multipleOf, 0.25);
      const create = (properties: EntityProperties) =>
        createEntity(entities, requestActor(owner.manager), { entity_type_id: type.id, schema_version: 2, properties });
      for (
        const properties of [{ prop_1: "readonly", prop_2: 7 }, { prop_1: "retired", prop_5: "입력 금지" }, {
          prop_1: "fraction",
          prop_3: 0.3,
        }] as EntityProperties[]
      ) {
        assertEquals((await assertRejects(() => create(properties), AppError)).code, "invalid_input");
      }
      const saved = await create({ prop_1: "원본", prop_3: 0.5 });
      assertEquals(saved.properties, { prop_1: "원본", prop_2: 7, prop_3: 0.5 });
      const same = await updateEntity(entities, requestActor(owner.manager), saved.id, {
        expected_version: saved.version,
        schema_version: 2,
        properties: { prop_2: 7, prop_3: 0.75 },
      });
      assertEquals(same.properties, { prop_1: "원본", prop_2: 7, prop_3: 0.75 });
      for (const properties of [{ prop_2: 8 }, { prop_3: 0.6 }, { prop_5: "새 입력" }] as EntityProperties[]) {
        assertEquals(
          (await assertRejects(() =>
            updateEntity(entities, requestActor(owner.manager), saved.id, {
              expected_version: same.version,
              schema_version: 2,
              properties,
            }), AppError)).code,
          "invalid_input",
        );
      }
    } finally {
      await owner.cleanup();
      await sql.end();
      await admin.end();
    }
  },
);
