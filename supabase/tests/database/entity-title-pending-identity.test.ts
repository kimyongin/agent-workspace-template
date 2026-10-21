import { assert, assertEquals } from "@std/assert";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as records from "../../functions/_shared/core/activity/application.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { prepareBusinessRecord } from "../../functions/_shared/core/settings/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import {
  businessRequest,
  businessWorkspaceFixture,
} from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 });
const user = connect(urls.pooler, { max: 1, prepare: false });

dbTest(
  "automatic identity completes an empty title and default record memo only after save; explicit memo survives",
  async () => {
    const fixture = await businessWorkspaceFixture(admin, user);
    const ed = { uow: new SqlEntityUnitOfWork(user) };
    const model = { uow: new SqlDataModelUnitOfWork(user) };
    const settings = {
      uow: new SqlBusinessSettingsUnitOfWork(user),
      clock: { now: () => new Date() },
    };
    const activity = {
      uow: new SqlUnitOfWork(user),
      clock: { now: () => new Date() },
    };
    try {
      const kind = await fixture.createKind("발급 전 제목");
      await fixture.grant(fixture.manager, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "write" },
      ]);
      const actor = fixture.manager;
      const document = await exportDataModel(model, actor);
      const type = document.entity_types.find((i) =>
        i.schema["x-type-id"] === kind.id
      )!;
      type.schema.properties.prop_2 = {
        type: "string",
        "x-order": 20,
        title: "선택 이름",
      };
      type.schema["x-title-template"] = "$prop_2$";
      const input = { mode: "update", document: JSON.stringify(document) };
      const review = await previewDataModel(model, actor, input);
      const plan = await prepareDataModel(model, businessRequest(actor), {
        ...input,
        preview_fingerprint: review.fingerprint,
      });
      assertEquals(
        (await applyDataModel(model, businessRequest(actor), plan.id, {
          expected_version: plan.version,
        })).status,
        "applied",
      );
      const prepare = async (properties: Record<string, unknown>) =>
        await prepareBusinessRecord(settings, actor, {
          model: "entity",
          action: "create",
          input: { entity_type_id: kind.id, schema_version: 2, properties },
        });
      const pending = await prepare({ prop_1: "필수 원문" });
      assertEquals(pending.pending_entity_id, true);
      assertEquals(pending.prepared_input.external_id, undefined);
      assertEquals(pending.prepared_input.properties, { prop_1: "필수 원문" });
      const first = await entities.createEntity(
        ed,
        businessRequest(actor),
        entityCreate.parse({
          ...pending.prepared_input,
          change_tag_ids: pending.change_tag_ids,
        }),
      );
      assert(first.external_id);
      assertEquals(first.title, first.external_id);
      const detail = await entities.getEntity(ed, actor, first.id);
      const record = await records.getRecord(
        activity,
        actor,
        detail.records.items[0].id,
      );
      assertEquals(record.change?.target_title, first.external_id);
      assert(record.body.includes(first.external_id));
      assertEquals(record.body.includes("저장 후 발급되는"), false);
      const edited = await entities.createEntity(
        ed,
        businessRequest(actor),
        entityCreate.parse({
          ...pending.prepared_input,
          change_note: "직접 쓴 메모",
          change_tag_ids: [],
        }),
      );
      const editedDetail = await entities.getEntity(ed, actor, edited.id);
      assertEquals(
        (await records.getRecord(
          activity,
          actor,
          editedDetail.records.items[0].id,
        )).body,
        "직접 쓴 메모",
      );
      const visible = await prepare({ prop_1: "원문", prop_2: "확정 제목" });
      assertEquals(visible.pending_entity_id, undefined);
      assert(visible.change_note.includes("확정 제목"));
      // Read-only preparation must not create or reserve another entity identity.
      assertEquals(
        (await entities.listEntities(ed, actor, {
          entity_type_id: kind.id,
          sort: "updated_at",
          limit: 100,
        })).items.length,
        2,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);
