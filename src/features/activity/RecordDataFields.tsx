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
      <section className="detail-section record-content">
        {body
          ? <div className="key-value-grid">{body}</div>
          : (
            <dl className="key-value-grid">
              <div className="key-value-full">
                <dt>본문</dt>
                <dd>
                  {record.body ? <MarkdownContent text={record.body} /> : "—"}
                </dd>
              </div>
            </dl>
          )}
      </section>
      <ChangeContext record={record} occurredAt={occurredAt} />
    </>
  );
}
