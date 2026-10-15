import { useId, useState } from "react";
import type { EntityType } from "@contracts/entity-type.ts";
export function EntityTypePicker(
  { types, value, onChange, all = false, disabled = false, error, compact = false }: {
    types: EntityType[];
    value: string;
    onChange: (id: string) => void;
    all?: boolean;
    disabled?: boolean;
    error?: string;
    compact?: boolean;
  },
) {
  const [keyword, setKeyword] = useState(""), id = useId();
  const options = types.filter((type) => type.label.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  const selected = types.find((type) => type.id === value);
  return (
    <div className="entity-type-picker">
      {!compact && types.length > 6 && (
        <label className="field">
          <span className="label">자료 종류 검색</span>
          <input
            className="input"
            type="search"
            value={keyword}
            disabled={disabled}
            onChange={(event) => setKeyword(event.target.value)}
            aria-controls={id}
          />
        </label>
      )}
      <div className="field">
        <label className={compact ? "label visually-hidden" : "label"} htmlFor={id}>자료 종류</label>
        <select
          id={id}
          className="input"
          value={value}
          disabled={disabled}
          aria-required={!all || undefined}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{all ? "전체 자료" : "자료 종류 선택"}</option>
          {selected && !options.some((type) => type.id === value) && (
            <option value={value}>{selected.label}{selected.archived ? " · 보관" : ""}</option>
          )}
          {options.map((type) => (
            <option key={type.id} value={type.id}>{type.label}{type.archived ? " · 보관" : ""}</option>
          ))}
          {value && !selected && <option value={value}>찾을 수 없는 자료 종류</option>}
        </select>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="error-text">{error}</p>}
      {keyword && !options.length && <p role="status" className="secondary">조건에 맞는 자료 종류가 없습니다.</p>}
    </div>
  );
}
