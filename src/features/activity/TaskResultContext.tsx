import type { TaskResult } from "@contracts/task.ts";
import { ChevronDownIcon } from "lucide-react";
import { DataField, DataFields } from "../../components/DataFields.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible.tsx";

/** Read the saved instruction without leaving the independent result draft. */
export function TaskResultContext({ task, occurrence }: { task: TaskResult; occurrence?: string }) {
  return (
    <section aria-label="기록할 할 일" className="flex min-w-0 flex-col gap-3">
      <DataFields>
        <DataField label="할 일">{task.title}</DataField>
        {occurrence && <DataField label="회차">{occurrence} · {task.timezone}</DataField>}
      </DataFields>
      {task.body && (
        <Collapsible className="group/task-instruction flex min-w-0 flex-col gap-3">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" className="max-w-full justify-between whitespace-normal">
              할 일 내용 확인
              <ChevronDownIcon
                data-icon="inline-end"
                className="transition-transform group-data-[state=open]/task-instruction:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <section
              aria-label="할 일 본문"
              tabIndex={0}
              className="max-h-[40dvh] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MarkdownContent text={task.body} />
            </section>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}
