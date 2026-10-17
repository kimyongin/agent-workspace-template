import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { Button } from "../../components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { BodyActionFace } from "../../components/BodyAction.tsx";
import { Field } from "../../components/Field.tsx";
import { ModalShell } from "../../components/Modal.tsx";
import { IssuerRegistryEditor, type RegistryEditTarget } from "./IssuerRegistryEditor.tsx";
import { issuerRegistry } from "./issuer-registry-api.ts";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
export function IdentitySourceModal({
  issuers,
  linked,
  onClose,
  onConnect,
  onIssuer,
  onRule,
  onState,
}: {
  issuers: EntityIssuer[];
  linked: string[];
  onClose: () => void;
  onConnect: (source: EntityIssuer, rule: IdentifierRule) => void;
  onIssuer: (source: EntityIssuer) => void;
  onRule: (rule: IdentifierRule) => void;
  onState: (state: MaterialSectionState) => void;
}) {
  const [source, setSource] = useState(""),
    [ruleId, setRuleId] = useState(""),
    [rules, setRules] = useState<IdentifierRule[] | null>(null),
    [error, setError] = useState("");
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
          const active = result.items.filter((r) => r.active);
          if (active.length === 1) setRuleId(active[0].id);
        }
      }).catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    }
    return () => c.abort();
  }, [source]);
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
      title="번호 출처 연결"
      description="이 자료 종류에 사용할 번호 출처와 번호 종류를 선택합니다."
      dirty={!!source || editState.dirty || !!editState.uncertain}
      busy={editState.busy || !!editState.uncertain}
      onClose={onClose}
      footer={(requestClose) => (
        <>
          <Button variant="outline"  type="button" onClick={requestClose}>취소</Button>
          <Button variant="default"
            
            type="button"
            disabled={!issuer?.active || !rule?.active || !!editing}
            onClick={() => {
              if (issuer && rule) onConnect(issuer, rule);
            }}
          >
            연결
          </Button>
        </>
      )}
    >
      <FieldGroup className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-wrap items-end gap-3 [&>div]:flex-1">
          <Field pair label="번호 출처">
            {(props) => (
              <NativeSelect
                {...props}
                ref={sourceSelect}
                
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <NativeSelectOption value="">선택</NativeSelectOption>
                {issuers.filter((i) => i.active && !linked.includes(i.code)).map((i) => (
                  <NativeSelectOption key={i.code} value={i.code}>{i.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Button variant="outline"
            type="button"
           
            ref={issuerAdd}
            onClick={() => {
              returnTo.current = "issuer";
              setEditing({ kind: "issuer" });
            }}
          >
            번호 출처 추가
          </Button>
        </div>
        {error && <Alert variant="destructive" className="text-sm text-destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {source && (
          <div className="flex min-w-0 flex-wrap items-end gap-3 [&>div]:flex-1">
            <div>
              {rules === null && !error
                ? <Alert role="status"><AlertDescription>번호 종류를 읽는 중…</AlertDescription></Alert>
                : eligible.length > 1
                ? (
                  <Field pair label="번호 종류">
                    {(props) => (
                      <NativeSelect
                        {...props}
                        
                        value={ruleId}
                        onChange={(e) => setRuleId(e.target.value)}
                      >
                        <NativeSelectOption value="">선택</NativeSelectOption>
                        {eligible.map((r) => <NativeSelectOption key={r.id} value={r.id}>{r.label}</NativeSelectOption>)}
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
                : <p className="text-sm text-muted-foreground">등록된 번호 종류가 없습니다.</p>}
            </div>
            {issuer && !issuer.system && (
              <Button variant="outline"
                type="button"
                className={eligible.length > 1 ? "" : ""}
                ref={ruleAdd}
                disabled={rules === null}
                onClick={() => {
                  returnTo.current = "rule";
                  setEditing({ kind: "rule", source, sourceLabel: issuer.label });
                }}
              >
                {eligible.length > 1 ? "번호 종류 추가" : <BodyActionFace icon="create">번호 종류 추가</BodyActionFace>}
              </Button>
            )}
          </div>
        )}
      </FieldGroup>
    </ModalShell>
  );
}
