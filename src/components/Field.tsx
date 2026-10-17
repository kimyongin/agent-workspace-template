// Application field identity connects existing drafts and validation to shadcn Field.
import { type ReactNode, useId } from "react";
import { Field as FieldRoot, FieldContent, FieldDescription, FieldError, FieldLabel } from "./ui/field.tsx";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { cn } from "../lib/utils.ts";

interface FieldProps {
  label: string;
  className?: string;
  fullWidth?: boolean;
  hideLabel?: boolean;
  required?: boolean;
  help?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "data-field-control": "" }) => ReactNode;
}

export function Field({ label, hideLabel = false, required, help, error, children, fullWidth = false, className }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`, errorId = `${id}-error`;
  const describedBy = [help && helpId, error && errorId].filter(Boolean).join(" ") || undefined;
  return <FieldRoot data-invalid={!!error} className={cn("min-w-0", fullWidth && "col-span-full", className)}>
    <FieldLabel htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
      {label}{required && <><span aria-hidden="true">*</span><span className="sr-only">(필수)</span></>}
    </FieldLabel>
    <FieldContent className="min-w-0">
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "data-field-control": "" })}
      {help && <FieldDescription id={helpId}>{help}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </FieldContent>
  </FieldRoot>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  return <Alert variant={kind === "error" ? "destructive" : "default"} role={kind === "error" ? "alert" : "status"}>
    <AlertDescription>{children}</AlertDescription>
  </Alert>;
}
