import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { BodyAction, BodyActionFace } from "../../components/BodyAction.tsx";
import { ConfirmationSurface } from "../../components/ConfirmDialog.tsx";
import "./tag-picker.css";

/** Selection belongs to the parent's draft; closing the chooser never saves the parent. */
export function TagSelection(
  { label, tags, value, onChange, error, status, excludeId, maxSelected = 10, disabled = false }: {
    label: string;
    tags: { id: string; name: string }[] | null;
    value: string[];
    onChange: (ids: string[]) => void;
    error?: string;
    status?: ReactNode;
    excludeId?: string;
    maxSelected?: number;
    disabled?: boolean;
  },
) {
  const id = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const knownNames = useRef(new Map<string, string>());
  // A successful dictionary is authoritative, including IDs that disappeared.
  // Keep its names only while a subsequent read has no dictionary snapshot.
  if (tags !== null) knownNames.current = new Map(tags.map((tag) => [tag.id, tag.name]));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [inheritedDisabled, setInheritedDisabled] = useState(false);
  // Native fieldset disabling does not cross the chooser's portal into the top layer.
  useEffect(() => {
    const parents: HTMLFieldSetElement[] = [];
    for (let parent = root.current?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLFieldSetElement) parents.push(parent);
    }
    const update = () => setInheritedDisabled(parents.some((parent) => parent.disabled));
    const observer = new MutationObserver(update);
    parents.forEach((parent) => observer.observe(parent, { attributes: true, attributeFilter: ["disabled"] }));
    update();
    return () => observer.disconnect();
  }, []);
  const busy = disabled || inheritedDisabled;
  const focusTrigger = () => trigger.current?.focus();
  const choices = (tags ?? []).filter((tag) =>
    tag.id !== excludeId && tag.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <fieldset
      ref={root}
      className="tag-picker"
      disabled={disabled}
      aria-labelledby={id}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="tag-picker-heading">
        <span className="tag-picker-heading-main">
          <span id={id} className="label">{label}</span>
          <button
            ref={trigger}
            type="button"
            className="body-action"
            disabled={busy}
            aria-haspopup="dialog"
            aria-label="태그 선택"
            onClick={() => {
              setSearch("");
              setOpen(true);
            }}
          >
            <BodyActionFace icon="create">태그 선택</BodyActionFace>
          </button>
        </span>
        <BodyAction
          icon="close"
          className="tag-clear-action"
          data-empty={!value.length || undefined}
          aria-hidden={!value.length || undefined}
          disabled={!value.length || busy}
          tabIndex={value.length ? undefined : -1}
          aria-label="모든 태그 선택 해제"
          onClick={() => {
            onChange([]);
            focusTrigger();
          }}
        >
          전체 해제
        </BodyAction>
      </legend>
      {(error || status || value.length > 0) && (
        <div className="field">
          {error && <p id={`${id}-error`} className="error-text">{error}</p>}
          {status}
          {value.length > 0 && (
            <div className="chips tag-selection">
              {value.map((selected, index) => {
                const name = knownNames.current.get(selected);
                return (
                  <button
                    type="button"
                    className="chip"
                    aria-pressed="true"
                    key={selected}
                    disabled={busy}
                    aria-label={name ? `${name} 선택 해제` : `이름 확인이 필요한 태그 ${index + 1} 선택 해제`}
                    onClick={() => {
                      onChange(value.filter((item) => item !== selected));
                      focusTrigger();
                    }}
                  >
                    <span>{name ?? "태그 확인 필요"}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {open && (
        <ConfirmationSurface
          open
          title={`${label} 선택`}
          closeButton
          busy={busy}
          onCancel={() => setOpen(false)}
          footer={
            <>
              <span className="tag-selection-count" role="status">{value.length}개 선택</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setOpen(false)}>
                선택 완료
              </button>
            </>
          }
        >
          <div className="tag-chooser">
            <label className="visually-hidden" htmlFor={`${id}-search`}>태그 이름 검색</label>
            <input
              id={`${id}-search`}
              className="input"
              type="search"
              placeholder="태그 이름 검색"
              value={search}
              disabled={busy}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            />
            {status}
            <div className="tag-chooser-options" role="group" aria-label="태그 목록" tabIndex={0}>
              {choices.map((tag) => (
                <label className="tag-chooser-option" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={value.includes(tag.id)}
                    disabled={busy || (!value.includes(tag.id) && maxSelected !== 1 && value.length >= maxSelected)}
                    onChange={() =>
                      onChange(
                        value.includes(tag.id)
                          ? value.filter((selected) => selected !== tag.id)
                          : maxSelected === 1
                          ? [tag.id]
                          : [...value, tag.id],
                      )}
                  />
                  <span>{tag.name}</span>
                </label>
              ))}
              {tags && !choices.length && (
                <p className="secondary">
                  {search.trim()
                    ? "일치하는 태그가 없습니다."
                    : tags.length === 0
                    ? "태그 관리에서 태그를 먼저 추가하세요."
                    : "선택할 수 있는 태그가 없습니다."}
                </p>
              )}
            </div>
            {maxSelected > 1 && value.length >= maxSelected && (
              <p className="secondary" role="status">태그는 최대 {maxSelected}개까지 선택할 수 있습니다.</p>
            )}
          </div>
        </ConfirmationSurface>
      )}
    </fieldset>
  );
}
