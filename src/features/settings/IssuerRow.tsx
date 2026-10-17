import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

/** A retained issuer editor; actions and disclosure remain independent controls. */
export function IssuerRow({ label, summary, open, onToggle, action, disabled, children }: {
  label: string; summary?: string; open: boolean; onToggle: () => void; action?: ReactNode; disabled?: boolean; children: ReactNode;
}) {
  const id = useId();
  return <Collapsible open={open} onOpenChange={onToggle} disabled={disabled} asChild>
    <section aria-label={label}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle><h2 className="min-w-0 [overflow-wrap:anywhere]">{label}</h2></CardTitle>
          {summary && <Badge variant="secondary">{summary}</Badge>}
          {action}
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={label} aria-controls={id}><ChevronDownIcon /></Button></CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent forceMount hidden={!open} id={id}><CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent></CollapsibleContent>
      </Card>
    </section>
  </Collapsible>;
}
