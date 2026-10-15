import { useState } from "react";
import { FilterPanel } from "../components/TabSearch.tsx";
import { Notice } from "../components/Field.tsx";
import { TagSelection } from "../features/tags/TagSelection.tsx";
import { TypedEntityFilters, validatePropertyFilters } from "../features/entity/TypedEntityFilters.tsx";
import { entitySchemaLimits, entitySchemaPolicy, type EntitySchemaResult } from "@contracts/entity-type.ts";
import type { entityPropertyFilter } from "@contracts/entity.ts";
import type { z } from "zod";

const schema: EntitySchemaResult = {
  type_id: "00000000-0000-4000-8000-000000000001",
  schema_version: 1,
  type: { id: "00000000-0000-4000-8000-000000000001", label: "자료", icon_id: "book", archived: false },
  created_at: "2026-10-16T00:00:00Z",
  constraints: entitySchemaLimits,
  policy: entitySchemaPolicy,
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    "x-type-id": "00000000-0000-4000-8000-000000000001",
    "x-version": 1,
    title: "자료",
    "x-icon": "book",
    deprecated: false,
    type: "object",
    additionalProperties: false,
    properties: {
      prop_1: {
        type: "string",
        title: "이름",
        minLength: 1,
        "x-order": 10,
        "x-representative": true,
        "x-show-in-list": true,
      },
      prop_2: { type: "string", title: "분류", "x-order": 20 },
    },
    required: ["prop_1"],
  },
};
const tagOptions = [{ id: "report", name: "보고서" }, { id: "project", name: "프로젝트" }, {
  id: "reference",
  name: "참고자료",
}];
const records = [
  { id: "report", prop_1: "월간 업무 보고서", prop_2: "운영", tags: ["report"] },
  { id: "project", prop_1: "프로젝트 정리", prop_2: "기획", tags: ["project"] },
  { id: "reference", prop_1: "디자인 참고자료", prop_2: "디자인", tags: ["reference"] },
];
const initialRaw = JSON.stringify([{ key: "prop_1", operator: "contains", value: "보고서" }, {
  key: "prop_2",
  operator: "eq",
  value: "운영",
}]);
const empty = { raw: "", sort: "updated_at", tags: [] as string[] };

/** In-memory data only; the controls and validation are the same ones used by the app. */
export function FilterSamples() {
  const [draft, setDraft] = useState({ ...empty, raw: initialRaw });
  const [applied, setApplied] = useState(empty);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const conditions = JSON.parse(applied.raw || "[]") as z.infer<typeof entityPropertyFilter>[];
  const rows = records.filter((row) =>
    (!applied.tags.length || applied.tags.some((id) => row.tags.includes(id))) &&
    conditions.every((condition) => {
      const value = row[condition.key as "prop_1" | "prop_2"];
      if (condition.operator === "unset") return !value;
      return condition.operator === "contains" ? value.includes(String(condition.value)) : value === condition.value;
    })
  );
  if (applied.sort === "title") rows.sort((a, b) => a.prop_1.localeCompare(b.prop_1, "ko"));
  return (
    <div className="samples-stack">
      <div className="query-bar">
        <div className="tab-filters">
          <FilterPanel
            dirty={dirty}
            onReset={() => {
              setDraft(empty);
              setError("");
            }}
            onApply={() => {
              try {
                setApplied({ ...draft, raw: validatePropertyFilters(draft.raw, schema) });
                setError("");
              } catch {
                setError("속성 조건을 확인하세요.");
              }
            }}
          >
            <div className="filter-grid" role="group" aria-label="자료 필터">
              <TypedEntityFilters
                schema={schema}
                raw={draft.raw || null}
                sort={draft.sort}
                onChange={(raw, sort) => setDraft((previous) => ({ ...previous, raw, sort }))}
              />
            </div>
            <TagSelection
              label="자료 태그"
              tags={tagOptions}
              value={draft.tags}
              maxSelected={1}
              onChange={(tags) => setDraft((previous) => ({ ...previous, tags }))}
            />
            {error && <Notice kind="error">{error}</Notice>}
          </FilterPanel>
        </div>
      </div>
      <section aria-label="적용된 조건의 자료 목록">
        <h3 className="section-title">자료 · {rows.length}개</h3>
        <ul className="list">
          {rows.map((row) => (
            <li className="list-item" key={row.id}>
              <span className="item-title">{row.prop_1}</span>
            </li>
          ))}
        </ul>
        {!rows.length && <p className="secondary">조건에 맞는 자료가 없습니다.</p>}
      </section>
    </div>
  );
}
