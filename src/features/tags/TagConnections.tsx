import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldSet } from "@/components/ui/field";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { entityPath } from "@contracts/entity-identity.ts";

import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { useRecordConfirmation } from "../../components/RecordConfirmation.tsx";
import { api } from "../../lib/api.ts";
import { TagNames, TagPicker, type TagScope } from "./TagPicker.tsx";

export function ReadonlyTags(
  { ids, scope, onRemove }: { ids: string[]; scope: TagScope; onRemove?: (id: string) => void },
) {
  return (
    <dl className="grid min-w-0 gap-2 [&_dt]:text-sm [&_dt]:text-muted-foreground">
      <div>
        <dt>태그</dt>
        <dd>
          {ids.length
            ? <TagNames compact scope={scope} ids={ids} onRemove={onRemove} />
            : <span className="text-sm text-muted-foreground">연결된 태그 없음</span>}
        </dd>
      </div>
    </dl>
  );
}

/** The chooser only changes this draft. A partial write owns its exact version and retry lifetime. */
export function TagConnections({ scope, target, readonly = false, onSaved, onDraftClosed }: {
  scope: TagScope;
  target: { id: string; version: number; tag_ids: string[]; schema_version?: number; title?: string };
  readonly?: boolean;
  onDraftClosed?: () => void;
  onSaved: (saved: { tag_ids: string[]; version: number; updated_at: string }) => void;
}) {
  const trigger = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState<typeof target | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (wasEditing.current && !editing) {
      trigger.current?.querySelector<HTMLButtonElement>('[aria-label="태그 연결"]')?.focus();
    }
    wasEditing.current = !!editing;
  }, [editing]);
  return (
    <section ref={trigger} className="flex min-w-0 flex-col gap-3" aria-label="태그 연결">
      {editing
        ? (
          <TagConnectionDraft
            scope={scope}
            target={editing}
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
                setEditing({ ...target, tag_ids: target.tag_ids.filter((tag) => tag !== id) });
              }}
            />
            {!readonly && (
              <Button
                variant="ghost"
                type="button"
                aria-label="태그 연결"
                onClick={() => {
                  setMessage(null);
                  setEditing({ ...target, tag_ids: [...target.tag_ids] });
                }}
              >
                <PlusIcon data-icon="inline-start" />
                연결
              </Button>
            )}
          </>
        )}
      {message && <Notice kind="success">{message}</Notice>}
    </section>
  );
}

function TagConnectionDraft({ scope, target, onCancel, onSaved }: {
  scope: TagScope;
  target: { id: string; version: number; tag_ids: string[]; schema_version?: number };
  onCancel: () => void;
  onSaved: (saved: { tag_ids: string[]; version: number; updated_at: string }) => void;
}) {
  const surface = useContext(SurfaceContext);
  const [draft, setDraft] = useState(target.tag_ids);
  const path = scope === "entity" ? entityPath(target.id) : `/${scope}s/${target.id}`;
  const confirmation = useRecordConfirmation({
    closeOnSuccess: true,
    describe: () => {
      const input = { tag_ids: [...draft], ...(scope === "entity" ? { schema_version: target.schema_version } : {}) };
      const expected_version = target.version;
      return {
        title: "태그 연결을 적용하시겠습니까?",
        label: "연결하고 저장",
        defaultNote: "태그 연결 변경",
        record: scope !== "record",
        preparation: scope === "record"
          ? undefined
          : () => ({ model: scope, action: "update", target_id: target.id, expected_version, input }),
        execute: async (requestKey, memo) => {
          const saved = await api<{ tag_ids: string[]; version: number; updated_at: string }>(
            "PATCH",
            path,
            { ...input, expected_version, ...(scope === "record" ? {} : memo) },
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
      <FieldSet disabled={frozen || confirmation.active}>
        <TagPicker
          disabled={frozen || confirmation.active}
          scope={scope}
          label="태그"
          value={draft}
          onChange={setDraft}
          error={confirmation.errors.tag_ids}
        />
      </FieldSet>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" type="button" disabled={frozen} onClick={onCancel}>연결 취소</Button>
        <Button
          type="button"
          disabled={confirmation.busy || confirmation.active}
          onClick={() =>
            scope === "record" || confirmation.uncertain
              ? void confirmation.write("save")
              : void confirmation.begin("save")}
        >
          {confirmation.busy ? "처리 중…" : confirmation.uncertain ? "같은 내용 다시 시도" : "연결 적용"}
        </Button>
      </div>
      {!confirmation.active && confirmation.failure && <Notice kind="error">{confirmation.failure}</Notice>}
    </>
  );
}
