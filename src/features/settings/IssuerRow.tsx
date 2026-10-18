import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { BusinessCell, BusinessDetails, BusinessDisclosureCell, BusinessRow } from "../../components/BusinessTable.tsx";

/** Settings rows retain their editor while the shared table reflows around them. */
export function IssuerRow({ label, summary, open, onToggle, action, disabled, children }: {
  label: string; summary?: string; open: boolean; onToggle?: () => void; action?: ReactNode; disabled?: boolean; children: ReactNode;
}) {
  const id = useId();
  const triggerName = action ? label : [label, summary].filter(Boolean).join(" ");
  return <>
    <BusinessRow aria-label={label} data-expanded={open || undefined}>
      <BusinessDisclosureCell>{onToggle && <Button type="button" variant="ghost" size="icon" aria-label={`${label} ${open ? "접기" : "열기"}`} aria-controls={id} aria-expanded={open} disabled={disabled} onClick={onToggle}>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </Button>}</BusinessDisclosureCell>
      <BusinessCell index={0}><h2 className="min-w-0 wrap-anywhere">{onToggle ? <Button type="button" variant="link" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere" aria-label={triggerName} aria-controls={id} aria-expanded={open} disabled={disabled} onClick={onToggle}>{label}</Button> : label}</h2></BusinessCell>
      <BusinessCell index={1}>{summary ? <Badge variant="secondary" className="h-auto max-w-full whitespace-normal wrap-anywhere">{summary}</Badge> : "—"}</BusinessCell>
    </BusinessRow>
    <BusinessDetails hidden={!open} id={id} role="region" aria-label={label}>{action}{children}</BusinessDetails>
  </>;
}
