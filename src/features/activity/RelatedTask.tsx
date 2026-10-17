import { Button } from "@/components/ui/button";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { useRelatedRead } from "../relations/useRelatedRead.ts";
import { ApiError } from "../../lib/api.ts";

export function RelatedTaskItem({ id, occurrence }: { id: string; occurrence: string | null }) {
  const read = useRelatedRead<TaskResult>(`/tasks/${id}`, { probe: true });
  const task = read.probe.value;
  const cause = read.probe.error;
  const error = cause ? cause instanceof ApiError && cause.status === 404 ? "missing" : "failed" : null;
  return (
    <>
      {task && (
        <RelatedPreviewItem
          resource={read.resource}
          to={`/tasks/${id}`}
          title={task.title}
          metadata={occurrence
            ? (
              <dl className="grid min-w-0 gap-4 @min-[36rem]:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
                <div>
                  <dt>회차</dt>
                  <dd>{occurrence}</dd>
                </div>
              </dl>
            )
            : undefined}
        />
      )}
      {!task && !error && <p className="text-sm text-muted-foreground" role="status">불러오는 중…</p>}
      {error && (
        <p className="text-sm text-muted-foreground">
          {error === "missing"
            ? "삭제된 할 일 또는 접근할 수 없는 할 일입니다."
            : "연결된 할 일을 불러오지 못했습니다."}
        </p>
      )}
      {error === "failed" && (
        <Button variant="outline" type="button" onClick={() => void read.resource.read("probe")}>
          할 일 다시 조회
        </Button>
      )}
    </>
  );
}
