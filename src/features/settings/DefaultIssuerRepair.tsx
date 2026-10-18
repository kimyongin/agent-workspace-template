import { Button } from "../../components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { useEffect, useRef, useState } from "react";
import { APP_IDENTIFIER_RULE_ID, type EntityTypeIdentity, type IdentityDefaultType } from "@contracts/entity-issuer.ts";

import { Field } from "../../components/Field.tsx";
import { useTypeIdentityPort } from "./issuer-registry-api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
/** Resolve one blocking default while keeping the original registry draft open. */
export function DefaultIssuerRepair({ type, blockedSource, blockedRule, onSaved, onState }: {
  type: IdentityDefaultType;
  blockedSource: string;
  blockedRule?: string;
  onSaved: () => void;
  onState: (busy: boolean, uncertain: boolean) => void;
}) {
  const typeIdentityPort = useTypeIdentityPort();
  const choice = useRef<HTMLSelectElement>(null);
  const [identity, setIdentity] = useState<EntityTypeIdentity | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const { attempt, busy, uncertain } = useWriteAttempt();
  useEffect(() => {
    onState(busy, uncertain);
  }, [busy, uncertain, onState]);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void typeIdentityPort.read(type.type_id, c.signal).then((row) => {
      if (!c.signal.aborted) {
        setIdentity(row);
        setSource("");
      }
    }).catch((e) => {
      if (!c.signal.aborted) setError(writeErrorMessage(e));
    });
    return () => c.abort();
  }, [type.type_id, revision]);
  useEffect(() => {
    if (identity) choice.current?.focus({ preventScroll: true });
  }, [identity]);
  const sources = identity
    ? [
      ...identity.sources,
      ...(!identity.sources.some((s) => s.code === "app")
        ? [{
          code: "app",
          rule_id: APP_IDENTIFIER_RULE_ID,
          active: true,
          referenced: false,
          source_label: "앱",
          rule_label: "자동 발급",
          generation: "automatic" as const,
        }]
        : []),
    ]
    : [];
  const choices = sources.filter((s) =>
    (s.active || s.code === "app") &&
    (s.code !== blockedSource || blockedRule !== undefined && s.rule_id !== blockedRule)
  );
  const save = async () => {
    if (!identity || !source || busy) return;
    setError("");
    try {
      await attempt.run(async () => {
        await typeIdentityPort.save(
          type.type_id,
          {
            label: identity.label,
            default_source: source,
            expected_version: identity.version,
            sources: sources.filter((s) =>
              identity.sources.some((current) => current.code === s.code) || s.code === source
            )
              .map(({ code, rule_id, active }) => ({ code, rule_id, active: active || code === source })),
          },
          new AbortController().signal,
          attempt.requestKey(),
        );
        onSaved();
      });
    } catch (e) {
      setError(writeErrorMessage(e));
    }
  };
  return (
    <FieldGroup className="min-w-0">
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {!identity && !error && <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>}
      {identity && (
        <Field label={`${type.label} 기본 번호 출처`}>
          {(props) => (
            <NativeSelect
              {...props}
              ref={choice}

              value={source}
              disabled={busy || uncertain}
              onChange={(e) => {
                setSource(e.target.value);
                attempt.reset();
              }}
            >
              <NativeSelectOption value="">선택하세요</NativeSelectOption>
              {choices.map((s) => <NativeSelectOption key={s.code} value={s.code}>{s.source_label} · {s.rule_label}</NativeSelectOption>)}
            </NativeSelect>
          )}
        </Field>
      )}
      {identity && choices.length === 0 && (
        <Alert role="status"><AlertDescription>다른 활성 번호 출처가 없습니다. 자료 설정에서 번호 출처를 연결한 뒤 다시 시도하세요.</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" type="button" disabled={!source || busy} onClick={() => void save()}>
          {uncertain ? "같은 요청 다시 확인" : busy ? "저장 중…" : "기본 번호 출처 변경"}
        </Button>
        {error && !uncertain && (
          <Button variant="ghost" type="button"
            disabled={busy}
            onClick={() => {
              setIdentity(null);
              attempt.reset();
              setRevision((v) => v + 1);
            }}
          >
            다시 조회
          </Button>
        )}
      </div>
    </FieldGroup>
  );
}
