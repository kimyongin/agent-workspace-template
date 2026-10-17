import { FieldSet } from "../components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx";
import { useState } from "react";
import { Field, Notice } from "../components/Field.tsx";
import { TagSelection } from "../features/tags/TagSelection.tsx";

const tags = [
  "중요",
  "진행 중",
  "참고",
  ...Array.from({ length: 8 }, (_, i) => i === 7 ? "공백없이길게이어진태그이름".repeat(4) : `태그 ${i + 4}`),
]
  .map((name, index) => ({ id: `tag-${index}`, name }));

export function TagSamples() {
  const [mode, setMode] = useState("normal");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="grid min-w-0 gap-4">
      <Field pair label="태그 예시 상태">
        {(props) => (
          <NativeSelect
            {...props}

            value={mode}
            onChange={(event) => {
              const next = event.target.value;
              setMode(next);
              setSelected(
                next === "excluded"
                  ? [tags[0].id]
                  : next === "unknown"
                  ? [tags[0].id]
                  : ["loading", "failure", "busy"].includes(next)
                  ? [tags[0].id]
                  : [],
              );
            }}
          >
            <NativeSelectOption value="normal">일반 선택</NativeSelectOption>
            <NativeSelectOption value="single">단일 태그 필터</NativeSelectOption>
            <NativeSelectOption value="excluded">제외한 기존 선택</NativeSelectOption>
            <NativeSelectOption value="many">선택 한도</NativeSelectOption>
            <NativeSelectOption value="empty">태그 없음</NativeSelectOption>
            <NativeSelectOption value="loading">불러오는 중</NativeSelectOption>
            <NativeSelectOption value="failure">조회 실패</NativeSelectOption>
            <NativeSelectOption value="unknown">이름 확인 필요</NativeSelectOption>
            <NativeSelectOption value="busy">저장 중</NativeSelectOption>
          </NativeSelect>
        )}
      </Field>
      <FieldSet disabled={mode === "busy"} className="min-w-0 border-0 p-0">
        <TagSelection
          disabled={mode === "busy"}
          label="기본 기록 태그"
          tags={mode === "loading" || mode === "failure"
            ? null
            : mode === "empty" || mode === "unknown"
            ? []
            : mode === "many"
            ? tags
            : tags.slice(0, 3)}
          maxSelected={mode === "single" ? 1 : 10}
          excludeId={mode === "excluded" ? tags[0].id : undefined}
          value={selected}
          onChange={setSelected}
          status={mode === "loading"
            ? <p className="text-sm text-muted-foreground" role="status">태그를 불러오는 중…</p>
            : mode === "failure"
            ? <Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice>
            : undefined}
        />
      </FieldSet>
    </div>
  );
}
