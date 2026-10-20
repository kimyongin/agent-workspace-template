import type { ReactNode } from "react";
import type { RecordResult } from "@contracts/record.ts";
import { DataFields, DataField, DataFieldGroup } from "../../components/DataFields.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { ChangeContext } from "./ChangeContext.tsx";

/** Saved context keeps the same order when the body and permitted timestamp become inputs. */
export function RecordDataFields({ record, body, occurredAt }: {
  record: RecordResult;
  body?: ReactNode;
  occurredAt?: ReactNode;
}) {
  return <>
    <section className="flex min-w-0 flex-col gap-4">
      {body ? <DataFieldGroup>{body}</DataFieldGroup> : <DataFields><DataField label="본문">
        {record.body ? <MarkdownContent text={record.body} /> : "—"}
      </DataField></DataFields>}
      <DataFields><DataField label="작성자">{record.created_by_name ?? "—"}</DataField></DataFields>
    </section>
    <ChangeContext record={record} occurredAt={occurredAt} />
  </>;
}
