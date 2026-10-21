import { assertEquals } from "@std/assert";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import {
  createEntitySchemaChange,
  getEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 1, prepare: false });

dbTest(
  "retained pre-title draft reads normalized add/update fields and restarts without changing raw approval evidence",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const model = { uow: new SqlDataModelUnitOfWork(user) };
    try {
      const kind = await fixture.createKind("전환 전 초안");
      const actor = fixture.manager;
      const document = await exportDataModel(model, actor);
      const schema = document.entity_types.find((t) => t.schema["x-type-id"] === kind.id)!.schema;
      const legacy = structuredClone(schema);
      delete (legacy as Record<string, unknown>)["x-title-template"];
      const first = {
        ...legacy.properties.prop_1,
        "x-representative": false,
        "x-show-in-list": true,
        "x-list-order": 2,
      };
      const added = {
        type: "string" as const,
        "x-order": 20,
        title: "이전 추가 이름",
        "x-representative": true,
        "x-show-in-list": true,
        "x-list-order": 1,
      };
      legacy.properties = { prop_1: first, prop_2: added };
      legacy["x-version"] = 2;
      const rawEdits = [
        { op: "update_property", key: "prop_1", field: first, required: true },
        { op: "add_property", client_ref: "title", field: added, required: false },
      ];
      const oldId = crypto.randomUUID(), fingerprint = "b".repeat(64);
      // Exact retained envelope setup is separate from the public read/restart assertions.
      await admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${fixture.workspaceId},true)`;
        await tx`update app.entity_types set next_property_number=3 where workspace_id=${fixture.workspaceId} and id=${kind.id}`;
        await tx`insert into app.entity_schema_changes(workspace_id,type_id,id,source_type_version,source_schema_version,source_template_fingerprint,status,kind,edits,reservations,target,diff,fingerprint)
        values(${fixture.workspaceId},${kind.id},${oldId},1,1,${"a".repeat(64)},'draft','compatible',${
          tx.json(rawEdits)
        },'{"title":"prop_2"}',${tx.json({ schema: legacy })},'[]',${fingerprint})`;
      });
      schema.description = "전환 후 현재 정의";
      const input = { mode: "update", document: JSON.stringify(document) };
      const preview = await previewDataModel(model, actor, input);
      const plan = await prepareDataModel(model, businessRequest(actor), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      assertEquals(
        (await applyDataModel(model, businessRequest(actor), plan.id, { expected_version: plan.version })).status,
        "applied",
      );
      const raw = async () =>
        (await admin`select edits::text as edits,target::text as target,fingerprint,reservations::text as reservations,version,status,source_schema_version,created_at,updated_at from app.entity_schema_changes where workspace_id=${fixture.workspaceId} and id=${oldId}`)[
          0
        ];
      const before = await raw();
      const read = await getEntitySchemaChange(fixture.typeDeps, actor, kind.id, oldId);
      assertEquals(read.status, "stale");
      assertEquals(read.fingerprint, fingerprint);
      assertEquals(read.target.schema["x-title-template"], "$prop_2$");
      assertEquals(read.edits.map((edit) => edit.op), ["update_property", "add_property"]);
      for (const edit of read.edits) {
        if (edit.op !== "update_property" && edit.op !== "add_property") throw new Error("missing retained edit");
        assertEquals(
          ["x-representative", "x-show-in-list", "x-list-order"].some((key) => Object.hasOwn(edit.field, key)),
          false,
        );
      }
      const restarted = await createEntitySchemaChange(fixture.typeDeps, businessRequest(actor), kind.id, {
        expected_schema_version: 2,
        edits: [...read.edits, { op: "set_metadata", "x-title-template": "$new_title$" }],
      });
      assertEquals(restarted.id === oldId, false);
      assertEquals(restarted.source_schema_version, 2);
      assertEquals(restarted.reservations, { title: "prop_3" });
      assertEquals(restarted.target.schema["x-title-template"], "$prop_3$");
      assertEquals(restarted.target.schema.properties.prop_3.title, "이전 추가 이름");
      assertEquals(restarted.target.schema.properties.prop_1.minLength, first.minLength);
      assertEquals(await raw(), before);
      assertEquals((await getEntitySchemaChange(fixture.typeDeps, actor, kind.id, oldId)).status, "stale");
    } finally {
      await fixture.cleanup();
    }
  },
);
