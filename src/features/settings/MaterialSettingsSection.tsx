import { type ReactNode, useEffect, useId, useState } from "react";

export type MaterialSectionState = { dirty: boolean; busy: boolean; uncertain?: boolean; error?: boolean };
/** Collapsing a section hides its content without disposing an editor or its draft. */
export function MaterialSettingsSection(
  { title, summary, state, initialOpen = false, open: controlledOpen, onOpenChange, children }: {
    title: string;
    summary?: string;
    state?: MaterialSectionState;
    initialOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  },
) {
  const [localOpen, setOpen] = useState(initialOpen);
  const open = controlledOpen ?? localOpen;
  const id = useId();
  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen]);
  return (
    <section className="settings-section material-settings-section" aria-label={title}>
      <h2 className="settings-section-title">
        <button
          type="button"
          className="material-section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen(!open);
            onOpenChange?.(!open);
          }}
        >
          <span>{title}</span>
          <span className="secondary">
            {state?.busy
              ? "저장 중…"
              : state?.uncertain
              ? "결과 확인 필요"
              : state?.error
              ? "오류 · 미저장"
              : state?.dirty
              ? "미저장"
              : summary}
          </span>
        </button>
      </h2>
      <div id={id} hidden={!open}>{children}</div>
    </section>
  );
}
