// Field: 라벨 → 값 → 도움말/오류. 오류는 aria-describedby로 연결한다.
import { type ReactNode, useId } from "react";

interface FieldProps {
  label: string;
  className?: string;
  pair?: boolean;
  fullWidth?: boolean;
  hideLabel?: boolean;
  required?: boolean;
  help?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field(
  { label, hideLabel = false, required, help, error, children, pair = false, fullWidth = false, className = "" }:
    FieldProps,
) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help && helpId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${pair ? " key-value-pair" : ""}${fullWidth ? " key-value-full" : ""} ${className}`}>
      <label className={hideLabel ? "label visually-hidden" : "label"} htmlFor={id}>
        {label}
        {required && <span className="required" aria-hidden="true">*</span>}
        {required && <span className="visually-hidden">(필수)</span>}
      </label>
      {pair
        ? (
          <div className="field-value">
            {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
            {help && <p id={helpId} className="help" style={{ margin: 0 }}>{help}</p>}
            {error && <p id={errorId} className="error-text" style={{ margin: 0 }}>{error}</p>}
          </div>
        )
        : (
          <>
            {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
            {help && <p id={helpId} className="help" style={{ margin: 0 }}>{help}</p>}
            {error && <p id={errorId} className="error-text" style={{ margin: 0 }}>{error}</p>}
          </>
        )}
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  return (
    <div
      className={`notice${kind === "error" ? " notice-error" : kind === "success" ? " notice-success" : ""}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
