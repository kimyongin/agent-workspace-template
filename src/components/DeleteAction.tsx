import type { PrepareRecordMemo } from "@contracts/record-preparation.ts";
import { useEffect, type ReactNode } from "react";
import { useRecordConfirmation } from "./RecordConfirmation.tsx";

export interface DeletionOptions {
  message: ReactNode;
  onConfirm: (reason: string, tags: string[] | undefined, requestKey: () => string) => void | Promise<void>;
  note?: boolean;
  preparation?: () => PrepareRecordMemo;
}
export interface DeletionState { armed: boolean; busy: boolean; uncertain: boolean }
/** A management action uses the same record confirmation lifetime as form mutations. */
export function DeleteAction({message,onConfirm,note=true,onStateChange,label="삭제",disabled=false,excludeTag,preparation}: DeletionOptions & {
  onStateChange?: (state: DeletionState) => void; label?: string; disabled?: boolean; excludeTag?: string;
}) {
  const confirmation = useRecordConfirmation({
    clearOnCancel: true, closeOnSuccess: true,
    describe: () => ({
      title: "정말 삭제하시겠습니까?", label: "삭제하고 기록", pendingLabel: "삭제 중…",
      defaultNote: label === "삭제" ? "항목 삭제" : label,
      preparation, message, record: note, danger: true, excludeTag,
      execute: (requestKey, memo) => onConfirm(memo.change_note ?? "", memo.change_tag_ids, requestKey),
    }),
  });
  const { active: armed, busy, uncertain } = confirmation;
  useEffect(() => { onStateChange?.({armed,busy,uncertain}); }, [armed,busy,uncertain,onStateChange]);
  return <button type="button" className="btn btn-text btn-danger" aria-label={label} disabled={busy||disabled}
    onClick={() => confirmation.begin("delete")}>{label === "삭제" ? label : "삭제"}</button>;
}
