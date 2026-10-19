import type { ReactNode } from "react";
import type { RecordResult } from "@contracts/record.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { ChangeContext } from "./ChangeContext.tsx";

/** Saved context keeps the same order when the body and permitted timestamp become inputs. */
export function RecordDataFields({ record, body, occurredAt }: {
  record: RecordResult;
  body?: ReactNode;
  occurredAt?: ReactNode;
}) {
  return (
    <>
      <section className="flex min-w-0 flex-col gap-4">
        {body
          ? (
            <div className="grid min-w-0 gap-4 @min-[36rem]:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
              {body}
            </div>
          )
          : (
            <dl className="grid min-w-0 gap-4 @min-[36rem]:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
              <div className="col-span-full min-w-0">
                <dt>본문</dt>
                <dd>
                  {record.body ? <MarkdownContent text={record.body} /> : "—"}
                </dd>
              </div>
            </dl>
          )}
        <dl className="grid min-w-0 gap-4 @min-[36rem]:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:wrap-anywhere">
          <div>
            <dt>작성자</dt>
            <dd>{record.created_by_name ?? "—"}</dd>
          </div>
        </dl>
      </section>
      <ChangeContext record={record} occurredAt={occurredAt} />
    </>
  );
}
