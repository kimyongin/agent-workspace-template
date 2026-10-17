import { LinkIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldSet, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { IssuerRegistryEditor, type RegistryEditTarget } from "./IssuerRegistryEditor.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { typeIdentityUpdate } from "@contracts/entity-issuer.ts";

import { Field } from "../../components/Field.tsx";
import { writeErrorMessage } from "../../lib/write-attempt.ts";
import { issuerRegistry, typeIdentityPort } from "./issuer-registry-api.ts";
import { typeIdentitySettingsAdapter } from "./type-identity-settings.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { type MaterialSectionState, MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import { IdentitySourceModal } from "./IdentitySourceModal.tsx";
export function TypeIdentitySettings(
  { typeId, disabled = false, onState }: {
    typeId: string;
    disabled?: boolean;
    onState: (state: MaterialSectionState) => void;
  },
) {
  const adapter = useMemo(() => typeIdentitySettingsAdapter(typeId, typeIdentityPort), [typeId]);
  const editor = useSettingsDraft(adapter), { saved, draft, dirty, busy, uncertain, conflict, latestReady } = editor;
  const [issuers, setIssuers] = useState<EntityIssuer[]>([]),
    [rules, setRules] = useState<Record<string, IdentifierRule[]>>({}),
    [catalogError, setCatalogError] = useState("");
  const [connecting, setConnecting] = useState(false),
    [modalState, setModalState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const [registryEdit, setRegistryEdit] = useState<RegistryEditTarget | null>(null),
    [registryState, setRegistryState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const reportRegistry = useCallback((state: MaterialSectionState) => setRegistryState(state), []);
  const [message, setMessage] = useState(""), [inputError, setInputError] = useState("");
  const reportModal = useCallback((state: MaterialSectionState) => setModalState(state), []);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setCatalogError("");
    void issuerRegistry.list(c.signal).then(async (result) => {
      if (c.signal.aborted) return;
      setIssuers(result.items);
      const definitions = await Promise.all(
        (saved?.sources.map((source) => source.code) ?? []).map(async (code) =>
          [code, (await issuerRegistry.rules(code, c.signal)).items] as const
        ),
      );
      if (!c.signal.aborted) setRules((current) => ({ ...current, ...Object.fromEntries(definitions) }));
    }).catch((e) => {
      if (!c.signal.aborted) setCatalogError(e.message);
    });
    return () => c.abort();
  }, [saved, catalogRevision]);
  const state = {
    dirty: dirty || conflict || modalState.dirty || registryState.dirty,
    busy: busy && editor.operation === "save" || modalState.busy || registryState.busy,
    uncertain: uncertain || modalState.uncertain || registryState.uncertain,
    error: !!editor.error || !!inputError,
  };
  useEffect(() => {
    onState(state);
  }, [state.dirty, state.busy, state.uncertain, state.error, onState]);
  const update = (fn: (value: typeof draft) => typeof draft) => {
    setMessage("");
    setInputError("");
    editor.resource.edit(fn);
  };
  const sourceName = (code: string) =>
    issuers.find((i) => i.code === code)?.label ?? saved?.sources.find((s) => s.code === code)?.source_label ??
      "조회할 수 없는 번호 출처";
  const isAvailable = (code: string, ruleId: string) => {
    const issuer = issuers.find((i) => i.code === code);
    const rule = rules[code]?.find((r) => r.id === ruleId);
    return issuer
      ? issuer.active &&
        (rule?.active ?? saved?.sources.find((s) => s.code === code && s.rule_id === ruleId)?.active ?? false)
      : saved?.sources.find((s) => s.code === code && s.rule_id === ruleId)?.active ?? false;
  };
  const active = draft.sources.filter((s) => s.active && isAvailable(s.code, s.rule_id));
  const save = async () => {
    setMessage("");
    setInputError("");
    if (!saved) return;
    const parsed = typeIdentityUpdate.safeParse({ ...draft, expected_version: saved.version });
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message ?? "설정 입력을 확인하세요.");
      return;
    }
    if (await editor.resource.save()) setMessage("자료 번호 설정을 저장했습니다.");
  };
  const error = conflict
    ? "같은 자료 번호 설정이 변경되었습니다. 입력을 유지했습니다. 최신 저장값을 확인하고 비교하세요."
    : editor.error
    ? writeErrorMessage(editor.error)
    : inputError;
  return (
    <MaterialSettingsSection
      title="자료 번호"
      description="상품 번호처럼 자료를 구분할 번호를 설정합니다."
      state={state}
    >
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      {!saved && (
        <>
          {busy ? <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert> : (
            <Button variant="outline"
              type="button"

              onClick={() => void editor.resource.read()}
            >
              자료 번호 설정 다시 조회
            </Button>
          )}
        </>
      )}
      {saved && (
        <form
          className="flex min-w-0 flex-col gap-5"
          aria-label="자료 번호 설정"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {conflict && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline"

                type="button"
                disabled={busy || uncertain}
                onClick={() => void editor.resource.read()}
              >
                최신 저장값 확인
              </Button>
              {latestReady && (
                <>
                  <p className="text-sm text-muted-foreground">
                    최신 저장값: {saved.label} · 기본 번호 출처 {sourceName(saved.default_source)} ·{" "}
                    {saved.sources.filter((s) => s.active).map((s) => s.source_label).join(", ")}
                  </p>
                  <Button variant="outline"
                    type="button"

                    onClick={() => {
                      editor.resource.acceptLatest();
                      setInputError("");
                    }}
                  >
                    입력 유지하고 최신 버전 사용
                  </Button>
                </>
              )}
            </div>
          )}
          <FieldSet className="min-w-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]" disabled={busy || uncertain || disabled}>
            <Field pair label="이름" required help="자료에 표시할 번호 이름입니다. 예: 상품 번호·주문 번호">
              {(props) => (
                <Input
                  {...props}

                  required
                  value={draft.label}
                  onChange={(e) => update((v) => ({ ...v, label: e.target.value }))}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-medium">사용할 번호 출처</h3>
              <Button variant="ghost" type="button"  disabled={!!catalogError} onClick={() => setConnecting(true)}><LinkIcon data-icon="inline-start" />연결</Button>
            </div>
            {catalogError && (
              <Alert variant="destructive" className="text-sm text-destructive" role="alert"><AlertDescription>
                번호 출처·번호 종류를 읽지 못했습니다. {catalogError}{" "}
                <Button variant="outline" type="button"  onClick={() => setCatalogRevision((value) => value + 1)}>
                  번호 출처·번호 종류 다시 조회
                </Button>
              </AlertDescription></Alert>
            )}
            <div className="flex min-w-0 flex-col gap-3">
              {draft.sources.map((source) => {
                const metadata = saved.sources.find((s) => s.code === source.code),
                  issuer = issuers.find((i) => i.code === source.code),
                  options = rules[source.code]?.filter((r) => r.active || r.id === source.rule_id) ?? [],
                  rule = rules[source.code]?.find((r) => r.id === source.rule_id),
                  locked = metadata?.referenced || issuer?.system || source.code === "app",
                  available = isAvailable(source.code, source.rule_id);
                return (
                  <div key={source.code} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border py-3">
                    <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                      <Checkbox

                        checked={source.active}
                        disabled={!available && !source.active}
                        onCheckedChange={(checked) =>
                          update((v) => ({
                            ...v,
                            sources: v.sources.map((s) =>
                              s.code === source.code ? { ...s, active: checked === true } : s
                            ),
                          }))}
                      />
                      {sourceName(source.code)}
                    </FieldLabel>
                    <div className="col-span-full">
                      {locked || options.length <= 1
                        ? (
                          <dl className="grid min-w-0 gap-3 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
                            <div>
                              <dt>번호 종류</dt>
                              <dd>
                                {source.code === "app"
                                  ? "자동 발급"
                                  : rule?.label ?? metadata?.rule_label ?? "번호 종류"}
                                {metadata?.referenced && (
                                  <span className="text-sm text-muted-foreground" aria-label="사용 중인 번호 종류 · 변경 불가">
                                    · 변경 불가
                                  </span>
                                )}
                              </dd>
                            </div>
                          </dl>
                        )
                        : (
                          <Field pair label="번호 종류">
                            {(props) => (
                              <NativeSelect
                                {...props}

                                aria-label={`${sourceName(source.code)} 번호 종류`}
                                value={source.rule_id}
                                onChange={(e) =>
                                  update((v) => ({
                                    ...v,
                                    sources: v.sources.map((s) =>
                                      s.code === source.code ? { ...s, rule_id: e.target.value } : s
                                    ),
                                  }))}
                              >
                                {options.map((r) => (
                                  <NativeSelectOption key={r.id} value={r.id}>{r.label}{r.active ? "" : " (중지)"}</NativeSelectOption>
                                ))}
                              </NativeSelect>
                            )}
                          </Field>
                        )}
                      {!available && <span className="text-sm text-muted-foreground">· 사용 중지</span>}
                      {issuer && !issuer.system && (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Button variant="ghost" type="button"
                            aria-label={`${sourceName(source.code)} 편집`}
                            onClick={() => setRegistryEdit({ kind: "issuer", issuer })}
                          >
                            편집
                          </Button>
                          {!metadata?.referenced && (
                            <Button variant="ghost" type="button"

                              aria-label={`${sourceName(source.code)} 번호 종류 추가`}
                              disabled={!rules[source.code]}
                              onClick={() =>
                                setRegistryEdit({
                                  kind: "rule",
                                  source: source.code,
                                  sourceLabel: sourceName(source.code),
                                })}
                            ><PlusIcon data-icon="inline-start" />
                              번호 종류 추가
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <RadioGroup value={draft.default_source} onValueChange={code => update(v => ({ ...v, default_source: code }))} disabled={busy || uncertain || !source.active || !available} aria-label={`${sourceName(source.code)} 기본 번호 출처 선택`}>
                      <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3"><RadioGroupItem value={source.code} aria-label={`${sourceName(source.code)} 기본 번호 출처`} />기본</FieldLabel>
                    </RadioGroup>
                  </div>
                );
              })}
            </div>
            {!active.some((source) => source.code === draft.default_source) && (
              <p className="text-sm text-destructive">기본 번호 출처를 선택하세요.</p>
            )}
          </FieldSet>
          <div className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline"

                type="button"
                aria-label="변경 취소"
                disabled={busy || uncertain || disabled || (!dirty && !conflict) || conflict && !latestReady}
                onClick={() => {
                  editor.resource.reset();
                  setMessage("");
                  setInputError("");
                }}
              >
                취소
              </Button>
              <Button variant="default"

                aria-label={busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : "자료 번호 저장"}
                disabled={busy || disabled || conflict || (!dirty && !uncertain)}
              >
                {busy ? "저장 중…" : uncertain ? "같은 요청 다시 확인" : "저장"}
              </Button>
            </div>
          </div>
        </form>
      )}
      {registryEdit && (
        <IssuerRegistryEditor
          target={registryEdit}
          onClose={() => setRegistryEdit(null)}
          onState={reportRegistry}
          onSaved={(row) => {
            if ("code" in row) {
              setIssuers((current) => [...current.filter((s) => s.code !== row.code), row]);
            } else {setRules((current) => ({
                ...current,
                [row.source]: [...(current[row.source] ?? []).filter((r) => r.id !== row.id), row],
              })
              );}
            setRegistryEdit(null);
            void editor.resource.read();
          }}
        />
      )}
      {connecting && (
        <IdentitySourceModal
          issuers={issuers}
          linked={draft.sources.map((s) => s.code)}
          onClose={() => setConnecting(false)}
          onIssuer={(source) => setIssuers((current) => [...current.filter((s) => s.code !== source.code), source])}
          onRule={(rule) =>
            setRules((current) => ({
              ...current,
              [rule.source]: [...(current[rule.source] ?? []).filter((r) => r.id !== rule.id), rule],
            }))}
          onState={reportModal}
          onConnect={(issuer, rule) => {
            setRules((current) => ({
              ...current,
              [rule.source]: [...(current[rule.source] ?? []).filter((r) => r.id !== rule.id), rule],
            }));
            update((value) => ({
              ...value,
              sources: [...value.sources, { code: issuer.code, rule_id: rule.id, active: true }],
            }));
            setConnecting(false);
          }}
        />
      )}
    </MaterialSettingsSection>
  );
}
