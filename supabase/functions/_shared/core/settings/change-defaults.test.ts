import { assertEquals } from "@std/assert";
import {
  DEFAULT_RECORD_MEMO_TEMPLATES,
  editableRecordTemplates,
  effectiveRecordTemplate,
  recordTemplates,
} from "../../contracts/record-template.ts";
import type { ChangeInput } from "../shared/changes.ts";
import { changeDefaults } from "./change-defaults.ts";

Deno.test("record deletion uses its existing action memo without introducing record template variables", () => {
  const input: ChangeInput = {
    target_kind: "record",
    action: "delete",
    target: { id: "record", title: "기록", entity_ids: [], entity_context: [] },
    before: { body: "원문" },
    after: null,
  };
  assertEquals(changeDefaults(input, {}, []).change_note, "기록 삭제");
});

Deno.test("사용자 설정이 없으면 설정과 기록 준비가 같은 기본 템플릿을 사용한다", () => {
  const input: ChangeInput = {
    target_kind: "entity",
    action: "update",
    target: { id: "app:test", title: "고객", entity_ids: [], entity_context: [] },
    before: { properties: { prop_2: 1 } },
    after: { properties: { prop_2: 2 } },
  };
  assertEquals(effectiveRecordTemplate(undefined, "entity", "update").memo, DEFAULT_RECORD_MEMO_TEMPLATES.update);
  assertEquals(editableRecordTemplates(), {});
  assertEquals(changeDefaults(input, {}, []).change_note, "고객 수정 (prop_2)");
  const tag = crypto.randomUUID();
  const legacy = { entity: { update: { memo: "", tag_ids: [tag] } } };
  assertEquals(editableRecordTemplates(legacy).entity?.update, {
    memo: DEFAULT_RECORD_MEMO_TEMPLATES.update,
    tag_ids: [tag],
  });
  assertEquals(legacy.entity.update.memo, "");
  assertEquals(changeDefaults(input, { record_templates: legacy }, [tag]), {
    change_note: "고객 수정 (prop_2)",
    change_tag_ids: [tag],
    missing_tag_ids: [],
  });
  assertEquals(
    changeDefaults(input, { record_templates: { entity: { update: { memo: "${대상$}: ${액션$}", tag_ids: [] } } } }, [])
      .change_note,
    "고객: 수정",
  );
  assertEquals(changeDefaults({ ...input, change_note: "직접 쓴 메모" }, {}, []).change_note, "직접 쓴 메모");
});

Deno.test("type-bound templates retain zero/false and explicit memo precedence", () => {
 const typeId=crypto.randomUUID();
 const templates=recordTemplates.parse({entity_types:{[typeId]:{update:{memo:"$엔터티.이후.prop_2$ / $엔터티.이후.prop_3$",tag_ids:[]}}}});
 const input:ChangeInput={target_kind:"entity",action:"update",target:{id:"app:test",title:"재료",entity_ids:[],entity_context:[]},before:{entity_type_id:typeId,properties:{prop_2:1,prop_3:true}},after:{entity_type_id:typeId,properties:{prop_2:0,prop_3:false}}};
 assertEquals(changeDefaults(input,{record_templates:templates},[]).change_note,"0 / false");
 assertEquals(changeDefaults({...input,change_note:"직접 메모"},{record_templates:templates},[]).change_note,"직접 메모");
 assertEquals(changeDefaults({...input,after:{entity_type_id:crypto.randomUUID(),properties:{prop_2:0}}},{record_templates:templates},[]).change_note,"재료 수정 (prop_2)");
});
