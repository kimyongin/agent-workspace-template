import { useSettingsAccess } from "./workspace-settings-access.tsx";
import { CollectionEmpty } from "../../components/CollectionEmpty.tsx";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { Button } from "../../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";

import { Field } from "../../components/Field.tsx";
import { ModalShell } from "../../components/Modal.tsx";
import { IssuerRegistryEditor, type RegistryEditTarget } from "./IssuerRegistryEditor.tsx";
import { useIssuerRegistry } from "./issuer-registry-api.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
export function IdentitySourceModal({
  issuers,
  linkedKindIds,
  onClose,
  onConnect,
  onIssuer,
  onRule,
  onState,
}: {
  issuers: EntityIssuer[];
  linkedKindIds: string[];
  onClose: () => void;
  onConnect: (source: EntityIssuer, rule: IdentifierRule) => void;
  onIssuer: (source: EntityIssuer) => void;
  onRule: (rule: IdentifierRule) => void;
  onState: (state: MaterialSectionState) => void;
}) {
  const { canWrite } = useSettingsAccess();
  const issuerRegistry = useIssuerRegistry();
  const [source, setSource] = useState(""),
    [ruleId, setRuleId] = useState(""),
    [rules, setRules] = useState<IdentifierRule[] | null>(null),
    [error, setError] = useState("");
  const [readRevision, setReadRevision] = useState(0);
  const [editing, setEditing] = useState<RegistryEditTarget | null>(null),
    [editState, setEditState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const report = useCallback((state: MaterialSectionState) => setEditState(state), []);
  const issuerAdd = useRef<HTMLButtonElement>(null), ruleAdd = useRef<HTMLButtonElement>(null);
  const sourceSelect = useRef<HTMLSelectElement>(null);
  const returnTo = useRef<"issuer" | "rule" | null>(null);
  useEffect(() => {
    if (!editing && returnTo.current) {
      const frame = requestAnimationFrame(() => {
        const target = (returnTo.current === "issuer" ? issuerAdd : ruleAdd).current;
        (target && !target.disabled ? target : sourceSelect.current)?.focus();
        returnTo.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editing]);
  const rulesRequest = useRef<AbortController | null>(null);
  const issuer = issuers.find((i) => i.code === source), rule = rules?.find((r) => r.id === ruleId);
  const eligible = rules?.filter((r) => r.active) ?? [];
  useEffect(() => {
    const c = new AbortController();
    rulesRequest.current = c;
    setRules(null);
    setRuleId("");
    setError("");
    if (source) {
      void issuerRegistry.rules(source, c.signal).then((result) => {
        if (!c.signal.aborted) {
          setRules(result.items);
          const active = result.items.filter((r) => r.active && !linkedKindIds.includes(r.id));
          if (active.length === 1) setRuleId(active[0].id);
        }
      }).catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    }
    return () => c.abort();
  }, [source, readRevision]);
  useEffect(() => {
    onState({ dirty: !!source || editState.dirty, busy: editState.busy, uncertain: editState.uncertain });
  }, [source, editState, onState]);
  useEffect(() => () => onState({ dirty: false, busy: false, uncertain: false }), [onState]);
  const saved = (row: EntityIssuer | IdentifierRule) => {
    if ("code" in row) {
      onIssuer(row);
      setSource(row.code);
      returnTo.current = "rule";
      setEditing({ kind: "rule", source: row.code, sourceLabel: row.label, createdIssuer: true });
      return;
    } else {
      rulesRequest.current?.abort();
      setRules((current) => [...(current ?? []).filter((r) => r.id !== row.id), row]);
      setRuleId(row.id);
      onRule(row);
    }
    setEditing(null);
    setEditState({ dirty: false, busy: false });
  };
  // Keep the connection draft in this component while its one auxiliary surface changes mode.
  if (editing) {
    return (
      <IssuerRegistryEditor
        key={editing.kind === "issuer" ? "issuer:new" : `rule:${editing.source}`}
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={saved}
        onState={report}
      />
    );
  }
  return (
    <ModalShell
      open
      scrollHeaderWithBody
      title="식별자 종류 추가"
      description="이 항목에 허용할 식별자 종류를 선택하거나 새로 만듭니다."
      dirty={!!source || editState.dirty || !!editState.uncertain}
      busy={editState.busy || canWrite && !!editState.uncertain}
      onClose={onClose}
      footer={(requestClose) => (
        <>
          <Button variant="outline" type="button" onClick={requestClose}>취소</Button>
          <Button
            variant="default"
            type="button"
            disabled={!canWrite || !issuer?.active || !rule?.active || linkedKindIds.includes(ruleId) || !!editing}
            onClick={() => {
              if (!canWrite) return;
              if (canWrite && issuer && rule) onConnect(issuer, rule);
            }}
          >
            연결
          </Button>
        </>
      )}
    >
      <FieldGroup className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-wrap items-end gap-3 [&>div]:flex-1">
          <Field label="번호 출처">
            {(props) => (
              <NativeSelect
                {...props}
                ref={sourceSelect}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <NativeSelectOption value="">선택</NativeSelectOption>
                {issuers.filter((i) => i.active).map((i) => (
                  <NativeSelectOption key={i.code} value={i.code}>{i.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Button
            variant="outline"
            className="h-auto max-w-full whitespace-normal"
            type="button"
            ref={issuerAdd}
            onClick={() => {
              if (!canWrite) return;
              returnTo.current = "issuer";
              setEditing({ kind: "issuer" });
            }}
          >
            번호 출처 추가
          </Button>
        </div>
        {error && (
          <Alert variant="destructive" className="text-sm text-destructive" role="alert">
            <AlertDescription className="flex flex-col items-start gap-2">
              {error}
              <Button
                variant="outline"
                className="h-auto max-w-full whitespace-normal"
                type="button"
                onClick={() => {
                  // The error action disappears while reading; keep focus on the retained source.
                  sourceSelect.current?.focus();
                  setReadRevision((value) => value + 1);
                }}
              >
                <RotateCcwIcon data-icon="inline-start" />번호 종류 다시 조회
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {source && (
          <div className="flex min-w-0 flex-wrap items-end gap-3 [&>div]:flex-1">
            <div>
              {rules === null && !error
                ? (
                  <Alert role="status">
                    <AlertDescription>번호 종류를 읽는 중…</AlertDescription>
                  </Alert>
                )
                : eligible.length > 1
                ? (
                  <Field label="번호 종류">
                    {(props) => (
                      <NativeSelect
                        {...props}
                        value={ruleId}
                        onChange={(e) => setRuleId(e.target.value)}
                      >
                        <NativeSelectOption value="">선택</NativeSelectOption>
                        {eligible.map((r) => (
                          <NativeSelectOption key={r.id} value={r.id} disabled={linkedKindIds.includes(r.id)}>
                            {r.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )
                : eligible.length === 1
                ? (
                  <p>
                    {eligible[0].label}
                    {eligible[0].generation === "automatic" && eligible[0].label !== "자동 발급" ? " · 자동 발급" : ""}
                  </p>
                )
                : !error && (
                  <CollectionEmpty
                    title="등록된 번호 종류가 없습니다."
                    description={canWrite && issuer && !issuer.system
                      ? "번호 종류 추가로 이 출처에서 사용할 번호를 설정하세요."
                      : undefined}
                  />
                )}
            </div>
            {issuer && !issuer.system && (
              <Button
                variant="outline"
                className="h-auto max-w-full whitespace-normal"
                type="button"
                ref={ruleAdd}
                disabled={rules === null}
                onClick={() => {
                  if (!canWrite) return;
                  returnTo.current = "rule";
                  setEditing({ kind: "rule", source, sourceLabel: issuer.label });
                }}
              >
                {eligible.length > 1 ? "번호 종류 추가" : (
                  <>
                    <PlusIcon data-icon="inline-start" />번호 종류 추가
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </FieldGroup>
    </ModalShell>
  );
}
