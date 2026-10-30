import { DataFields } from "@/components/DataFields";
import { useApi } from "../../lib/api-context.tsx";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldSet } from "@/components/ui/field";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { useRecordConfirmation } from "../../components/RecordConfirmation.tsx";

import { TagNames, TagPicker, type TagScope } from "./TagPicker.tsx";

export function ReadonlyTags(
  { ids, scope, onRemove }: { ids: string[]; scope: TagScope; onRemove?: (id: string) => void },
) {
  return (
    <DataFields>
      <div>
        <dt>태그</dt>
        <dd>
          {ids.length
            ? <TagNames compact scope={scope} ids={ids} onRemove={onRemove} />
            : <span className="text-sm text-muted-foreground">연결된 태그 없음</span>}
        </dd>
      </div>
    </DataFields>
  );
}

/** The chooser only changes this draft. A partial write owns its exact version and retry lifetime. */
export function TagConnections({ scope, target, readonly = false, visible = true, onSaved, onDraftClosed }: {
  scope: TagScope;
  target: { id: string; version: number; tag_ids: string[]; title?: string };
  readonly?: boolean;
  visible?: boolean;
  onDraftClosed?: () => void;
  onSaved: (saved: { tag_ids: string[]; version: number; updated_at: string }) => void;
}) {
  const trigger = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState<(typeof target & { openPicker: boolean }) | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const destination = trigger.current?.querySelector<HTMLButtonElement>('[aria-label="태그 연결"]') ?? trigger.current;
      destination?.focus();
    }
    wasEditing.current = !!editing;
  }, [editing]);
  return (
    <section ref={trigger} hidden={!visible} tabIndex={-1} className="flex min-w-0 flex-col gap-3" aria-label="태그 연결">
      {editing
        ? (
          <TagConnectionDraft
            scope={scope}
            target={editing}
            openPicker={editing.openPicker}
            readonly={readonly}
            visible={visible}
            onCancel={() => {
              setEditing(null);
              onDraftClosed?.();
            }}
            onSaved={(saved) => {
              onSaved(saved);
              setEditing(null);
              setMessage("태그 연결을 저장했습니다.");
            }}
          />
        )
        : (
          <>
            <ReadonlyTags
              scope={scope}
              ids={target.tag_ids}
              onRemove={readonly ? undefined : (id) => {
                setMessage(null);
                setEditing({ ...target, tag_ids: target.tag_ids.filter((tag) => tag !== id), openPicker: false });
              }}
            />
            {!readonly && (
              <Button
                variant="ghost"
                type="button"
                aria-label="태그 연결"
                onClick={() => {
                  setMessage(null);
                  setEditing({ ...target, tag_ids: [...target.tag_ids], openPicker: true });
                }}
              >
                <PlusIcon data-icon="inline-start" />
                태그 연결
              </Button>
            )}
          </>
        )}
      {message && <Notice kind="success">{message}</Notice>}
    </section>
  );
}

function TagConnectionDraft({ scope, target, openPicker, readonly, visible, onCancel, onSaved }: {
  scope: TagScope;
  target: { id: string; version: number; tag_ids: string[] };
  openPicker: boolean;
  readonly: boolean;
  visible: boolean;
  onCancel: () => void;
  onSaved: (saved: { tag_ids: string[]; version: number; updated_at: string }) => void;
}) {
  const api = useApi();
  const surface = useContext(SurfaceContext);
  const [draft, setDraft] = useState(target.tag_ids);
  const confirmation = useRecordConfirmation({
    closeOnSuccess: true,
    disabled: readonly,
    visible,
    describe: () => {
      const input = { tag_ids: [...draft] };
      const expected_version = target.version;
      return {
        title: "태그 연결을 적용하시겠습니까?",
        label: "연결하고 저장",
        defaultNote: "태그 연결 변경",
        message: readonly ? "현재 읽기 전용입니다. 초안과 처리 중인 요청은 유지됩니다." : undefined,
        record: scope !== "record",
        preparation: scope === "record"
          ? undefined
          : () => ({ intent: "tag-connections", model: scope, action: "update", target_id: target.id, expected_version, input }),
        execute: async (requestKey, memo) => {
          const saved = await api<{ tag_ids: string[]; version: number; updated_at: string }>(
            "POST",
            "/tag-connections",
            { target_kind: scope, target_id: target.id, ...input, expected_version, ...(scope === "record" ? {} : memo) },
            undefined,
            requestKey(),
          );
          onSaved(saved);
        },
      };
    },
  });
  const frozen = confirmation.busy || confirmation.uncertain;
  const protect = surface?.protect;
  useLayoutEffect(() => {
    protect?.({ dirty: true, busy: frozen, discard: onCancel });
    return () => protect?.(null);
  }, [protect, frozen]);
  return (
    <>
      {readonly && <Notice>현재 읽기 전용입니다. 초안과 처리 중인 요청은 유지됩니다.</Notice>}
      <FieldSet disabled={readonly || frozen || confirmation.active}>
        <TagPicker
          disabled={readonly || frozen || confirmation.active}
          scope={scope}
          visible={visible}
          label="태그"
          defaultOpen={openPicker}
          value={draft}
          onChange={setDraft}
          error={confirmation.errors.tag_ids}
        />
      </FieldSet>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" type="button" disabled={frozen} onClick={onCancel}>연결 취소</Button>
        <Button
          type="button"
          disabled={readonly || confirmation.busy || confirmation.active}
          onClick={event =>
            scope === "record" || confirmation.uncertain
              ? void confirmation.write("save")
              : void confirmation.begin("save", event.currentTarget)}
        >
          {confirmation.busy ? "처리 중…" : confirmation.uncertain ? "같은 내용 다시 시도" : "연결 적용"}
        </Button>
      </div>
      {!confirmation.active && confirmation.failure && <Notice kind="error">{confirmation.failure}</Notice>}
    </>
  );
}
