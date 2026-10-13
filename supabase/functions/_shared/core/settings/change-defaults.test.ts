import { resolvedBusinessSettings } from "../../contracts/business-settings.ts";
import { assertEquals } from "@std/assert";
import {
  DEFAULT_RECORD_MEMO_TEMPLATES,
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
  const tag = crypto.randomUUID();
  const typeId = crypto.randomUUID();
  input.after = { ...input.after, entity_type_id: typeId };
  const value = { entity_types: { [typeId]: { update: { memo: null, tag_ids: [tag] } } } };
  assertEquals(changeDefaults(input, { record_templates: value }, [tag]), {
    change_note: "고객 수정 (prop_2)",
    change_tag_ids: [tag],
    missing_tag_ids: [],
  });
  assertEquals(value.entity_types[typeId].update.memo, null);
  assertEquals(
    changeDefaults(input, {
      record_templates: {
        entity_types: {
          [typeId]: {
            update: { memo: "${대상$}: ${액션$}", tag_ids: [] },
          },
        },
      },
    }, []).change_note,
    "고객: 수정",
  );
  assertEquals(changeDefaults({ ...input, change_note: "직접 쓴 메모" }, {}, []).change_note, "직접 쓴 메모");
});

Deno.test("type-bound templates retain zero/false and explicit memo precedence", () => {
  const typeId = crypto.randomUUID();
  const templates = recordTemplates.parse({
    entity_types: { [typeId]: { update: { memo: "$엔터티.이후.prop_2$ / $엔터티.이후.prop_3$", tag_ids: [] } } },
  });
  const input: ChangeInput = {
    target_kind: "entity",
    action: "update",
    target: { id: "app:test", title: "재료", entity_ids: [], entity_context: [] },
    before: { entity_type_id: typeId, properties: { prop_2: 1, prop_3: true } },
    after: { entity_type_id: typeId, properties: { prop_2: 0, prop_3: false } },
  };
  assertEquals(changeDefaults(input, { record_templates: templates }, []).change_note, "0 / false");
  assertEquals(
    changeDefaults({ ...input, change_note: "직접 메모" }, { record_templates: templates }, []).change_note,
    "직접 메모",
  );
  assertEquals(
    changeDefaults({ ...input, after: { entity_type_id: crypto.randomUUID(), properties: { prop_2: 0 } } }, {
      record_templates: templates,
    }, []).change_note,
    "재료 수정 (prop_2)",
  );
});

Deno.test("구 공통 자료 메모를 읽어도 종류의 고정 기본값이며 다른 설정은 보존한다", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const tag = "00000000-0000-4000-8000-000000000002";
  const old = {
    record_templates: {
      entity: { create: { memo: "old common", tag_ids: [tag] } },
      entity_types: { [id]: { create: { memo: "", tag_ids: [tag] } } },
      task: { create: { memo: "task memo", tag_ids: [] } },
    },
  };
  const saved = resolvedBusinessSettings(old as unknown as Parameters<typeof resolvedBusinessSettings>[0]);
  assertEquals(saved.record_templates, {
    entity_types: { [id]: { create: { memo: null, tag_ids: [tag] } } },
    task: { create: { memo: "task memo", tag_ids: [] } },
  });
  const input: ChangeInput = {
    target_kind: "entity",
    action: "create",
    target: { id: "app:new", title: "재료", entity_ids: [], entity_context: [] },
    before: null,
    after: { entity_type_id: id, properties: { prop_1: "재료" } },
  };
  assertEquals(changeDefaults(input, saved, [tag]), {
    change_note: "재료 등록",
    change_tag_ids: [tag],
    missing_tag_ids: [],
  });
  assertEquals(old.record_templates.entity_types[id].create.memo, "");
});
