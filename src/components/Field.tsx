// Application field identity connects existing drafts and validation to shadcn Field.
import { type ReactNode, useId } from "react";
import { Field as FieldRoot, FieldContent, FieldDescription, FieldError, FieldLabel } from "./ui/field.tsx";
import { Alert, AlertDescription } from "./ui/alert.tsx";
import { cn } from "../lib/utils.ts";
import { Badge } from "./ui/badge.tsx";

interface FieldProps {
  label: string;
  className?: string;
  fullWidth?: boolean;
  hideLabel?: boolean;
  required?: boolean;
  help?: string;
  error?: string;
  changed?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "data-field-control": "" }) => ReactNode;
}

export function Field({ label, hideLabel = false, required, help, error, changed = false, children, fullWidth = false, className }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`, errorId = `${id}-error`, changedId = `${id}-changed`;
  const describedBy = [help && helpId, error && errorId, changed && changedId].filter(Boolean).join(" ") || undefined;
  return <FieldRoot data-invalid={!!error} data-changed={changed || undefined} className={cn("min-w-0", fullWidth && "col-span-full", className)}>
    <FieldLabel htmlFor={id} className={cn("flex-wrap", hideLabel && "sr-only")}>
      {label}{required && <><span aria-hidden="true">*</span><span className="sr-only">(필수)</span></>}
      {changed && <Badge aria-hidden="true">수정 중</Badge>}
    </FieldLabel>
    <FieldContent className="min-w-0">
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "data-field-control": "" })}
      {changed && <span id={changedId} className="sr-only">저장하지 않은 변경이 있습니다.</span>}
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
