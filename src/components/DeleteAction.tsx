import { Button } from "./ui/button.tsx";
import type { PrepareRecordMemo } from "@contracts/record-preparation.ts";
import { useEffect, type ReactNode } from "react";
import { useRecordConfirmation, type ConfirmationValue } from "./RecordConfirmation.tsx";

export interface DeletionOptions {
  message: ReactNode;
  target?: string;
  data?: ConfirmationValue[];
  onConfirm: (reason: string, tags: string[] | undefined, requestKey: () => string) => void | Promise<void>;
  note?: boolean;
  preparation?: () => PrepareRecordMemo;
}
export interface DeletionState { armed: boolean; busy: boolean; uncertain: boolean }
/** A management action uses the same record confirmation lifetime as form mutations. */
export function DeleteAction({message,target,data,onConfirm,note=true,onStateChange,label="삭제",disabled=false,excludeTag,preparation}: DeletionOptions & {
  onStateChange?: (state: DeletionState) => void; label?: string; disabled?: boolean; excludeTag?: string;
}) {
  const confirmation = useRecordConfirmation({
    clearOnCancel: true, closeOnSuccess: true,
    describe: () => ({
      title: "정말 삭제하시겠습니까?", label: "삭제하고 기록", pendingLabel: "삭제 중…",
      defaultNote: label === "삭제" ? "항목 삭제" : label,
      preparation, message, data: target ? [{label:"대상",value:target,fullWidth:true},{label:"작업",value:"삭제"},...(data ?? [])] : data, record: note, danger: true, excludeTag,
      execute: (requestKey, memo) => onConfirm(memo.change_note ?? "", memo.change_tag_ids, requestKey),
    }),
  });
  const { active: armed, busy, uncertain } = confirmation;
  useEffect(() => { onStateChange?.({armed,busy,uncertain}); }, [armed,busy,uncertain,onStateChange]);
  return <Button variant="destructive" type="button"  aria-label={label} disabled={busy||disabled}
    onClick={event => confirmation.begin("delete", event.currentTarget)}>{label === "삭제" ? label : "삭제"}</Button>;
}
