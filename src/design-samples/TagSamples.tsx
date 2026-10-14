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
    <div className="samples-stack">
      <Field label="태그 예시 상태">
        {(props) => (
          <select
            {...props}
            className="input"
            value={mode}
            onChange={(event) => {
              const next = event.target.value;
              setMode(next);
              setSelected(
                next === "unknown" ? ["unknown"] : ["loading", "failure", "busy"].includes(next) ? [tags[0].id] : [],
              );
            }}
          >
            <option value="normal">일반 선택</option>
            <option value="many">선택 한도</option>
            <option value="empty">태그 없음</option>
            <option value="loading">불러오는 중</option>
            <option value="failure">조회 실패</option>
            <option value="unknown">이름 확인 필요</option>
            <option value="busy">저장 중</option>
          </select>
        )}
      </Field>
      <fieldset disabled={mode === "busy"} className="plain-fieldset">
        <TagSelection
          label="예시 태그"
          tags={mode === "loading" || mode === "failure"
            ? null
            : mode === "empty" || mode === "unknown"
            ? []
            : mode === "many"
            ? tags
            : tags.slice(0, 3)}
          value={selected}
          onChange={setSelected}
          status={mode === "loading"
            ? <p className="secondary" role="status">태그를 불러오는 중…</p>
            : mode === "failure"
            ? <Notice kind="error">태그를 불러오지 못했습니다. 기존 선택은 유지합니다.</Notice>
            : undefined}
        />
      </fieldset>
    </div>
  );
}
