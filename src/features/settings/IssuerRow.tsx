import { type ReactNode, useId } from "react";

/** Shared flat expandable row. Header actions have their own non-overlapping controls. */
export function IssuerRow(
  { label, summary, open, onToggle, action, disabled, children }: {
    label: string;
    summary?: string;
    open: boolean;
    onToggle: () => void;
    action?: ReactNode;
    disabled?: boolean;
    children: ReactNode;
  },
) {
  const id = useId();
  const toggle = {
    type: "button" as const,
    "aria-expanded": open,
    "aria-controls": id,
    onClick: onToggle,
    disabled,
  };
  return (
    <section className="issuer-entry" data-open={open} aria-label={label}>
      {action
        ? (
          <div className="issuer-entry-heading">
            <h2 className="item-title">
              {label}
              {summary && <span className="secondary">{summary}</span>}
            </h2>
            {action}
            <button
              {...toggle}
              className="issuer-source-toggle"
              aria-label={label}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        )
        : (
          <h2 className="item-title">
            <button {...toggle} className="material-section-toggle">
              <span>{label}</span>
              <span className="secondary">{summary}</span>
            </button>
          </h2>
        )}
      <div className="issuer-entry-content" id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
