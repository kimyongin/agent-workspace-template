import { type ReactNode, useId, useRef } from "react";
import { BodyAction } from "../../components/BodyAction.tsx";
import "./tag-picker.css";

/** Tag choices and their clear action share one presentation in the app and design samples. */
export function TagSelection({ label, tags, value, onChange, error, status, excludeId }: {
  label: string;
  tags: { id: string; name: string }[] | null;
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
  status?: ReactNode;
  excludeId?: string;
}) {
  const id = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  const heading = useRef<HTMLLegendElement>(null);
  const choices = tags?.filter((tag) => tag.id !== excludeId) ?? [];
  const unknown = tags ? value.filter((id) => !tags.some((tag) => tag.id === id)) : [];
  const focusChoice = () => {
    const choice = root.current?.querySelector<HTMLButtonElement>(
      ".tag-selection .chip[data-tag-option]:not(:disabled)",
    );
    (choice ?? heading.current)?.focus();
  };
  return (
    <fieldset
      ref={root}
      className="tag-picker"
      aria-labelledby={id}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend ref={heading} className="tag-picker-heading" tabIndex={-1}>
        <span id={id} className="label">{label}</span>
        {value.length > 0 && (
          <BodyAction
            icon="close"
            aria-label="모든 태그 선택 해제"
            onClick={() => {
              onChange([]);
              focusChoice();
            }}
          >
            전체 해제
          </BodyAction>
        )}
      </legend>
      <div className="field">
        {error && <p id={`${id}-error`} className="error-text">{error}</p>}
        {status}
        {(choices.length > 0 || unknown.length > 0) && (
          <div className="chips tag-selection">
            {choices.map((tag) => (
              <button
                type="button"
                className="chip"
                key={tag.id}
                data-tag-option
                aria-pressed={value.includes(tag.id)}
                disabled={!value.includes(tag.id) && value.length >= 10}
                onClick={() =>
                  onChange(
                    value.includes(tag.id) ? value.filter((id) => id !== tag.id) : [...value, tag.id],
                  )}
              >
                {tag.name}
              </button>
            ))}
            {unknown.map((id, index) => (
              <button
                type="button"
                className="chip"
                key={id}
                aria-pressed
                aria-label={`이름 확인이 필요한 태그 ${index + 1} 선택 해제`}
                onClick={() => {
                  onChange(value.filter((selected) => selected !== id));
                  focusChoice();
                }}
              >
                태그 확인 필요
              </button>
            ))}
          </div>
        )}
        {tags && !tags.length && !value.length && <p className="secondary">태그 관리에서 태그를 먼저 추가하세요.</p>}
        {value.length >= 10 && <p className="secondary" role="status">태그는 최대 10개까지 선택할 수 있습니다.</p>}
      </div>
    </fieldset>
  );
}
