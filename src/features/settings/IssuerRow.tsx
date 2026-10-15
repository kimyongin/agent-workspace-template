import { type ReactNode, useId } from "react";

/** Shared by the registry and public sample; its marker spans the expanded content. */
export function IssuerRow({ label, summary, open, onToggle, children }: {
  label: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="issuer-entry" data-open={open} aria-label={label}>
      <h2 className="item-title">
        <button
          className="material-section-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          <span>{label}</span>
          <span className="secondary">{summary}</span>
        </button>
      </h2>
      <div className="issuer-entry-content" id={id} hidden={!open}>{children}</div>
    </section>
  );
}
