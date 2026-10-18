import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

export type MaterialSectionState = { dirty: boolean; busy: boolean; uncertain?: boolean; error?: boolean };
/** Collapsing a section hides its content without disposing an editor or its draft. */
export function MaterialSettingsSection(
  { title, description, summary, state, initialOpen = false, open: controlledOpen, onOpenChange, children }: {
    title: string;
    description?: string;
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
  const status = state?.busy ? "저장 중…" : state?.uncertain ? "결과 확인 필요" : state?.error ? "오류 · 미저장" : state?.dirty ? "미저장" : summary;
  return <Collapsible open={open} onOpenChange={value => { setOpen(value); onOpenChange?.(value); }} asChild>
    <section aria-label={title} className="@container/material-section">
      <Card>
        <CardHeader className="@max-[16rem]/material-section:px-0.5">
          <CardTitle><h2>
            <CollapsibleTrigger asChild><Button type="button" variant="ghost" className="h-auto min-h-[max(2.75rem,44px)] w-full justify-between whitespace-normal text-left" aria-controls={id}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
              {status && <Badge variant={state?.error ? "destructive" : "secondary"}>{status}</Badge>}
              <ChevronDownIcon data-icon="inline-end" />
            </Button></CollapsibleTrigger>
          </h2></CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CollapsibleContent forceMount hidden={!open} id={id}>
          <CardContent className="@max-[16rem]/material-section:px-0.5">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </section>
  </Collapsible>;
}
