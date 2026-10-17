import { Alert, AlertDescription } from "@/components/ui/alert";

import { Button } from "../../components/ui/button.tsx";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/Modal.tsx";
import type { MaterialSectionState } from "./MaterialSettingsSection.tsx";
import type { EntityIssuer, IdentifierRule } from "@contracts/entity-issuer.ts";
import { BodyAction, BodyActionFace } from "../../components/BodyAction.tsx";
import { MaterialSettingsHeading } from "./MaterialSettingsHeading.tsx";
import { IssuerRegistryEditor, type RegistryEditTarget } from "./IssuerRegistryEditor.tsx";
import { IssuerRow } from "./IssuerRow.tsx";
import { issuerRegistry } from "./issuer-registry-api.ts";

export function IssuerSettingsPage() {
  const [issuers, setIssuers] = useState<EntityIssuer[] | null>(null),
    [selected, setSelected] = useState("");
  const [rules, setRules] = useState<IdentifierRule[] | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [ruleError, setRuleError] = useState("");
  const [revision, setRevision] = useState(0),
    [ruleRevision, setRuleRevision] = useState(0);
  const [editing, setEditing] = useState<RegistryEditTarget | null>(null),
    [message, setMessage] = useState("");
  const addButton = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const rulesRequest = useRef<AbortController | null>(null);
  const ruleListId = useId();
  const inline = editing?.kind === "rule" && !!editing.rule;
  const [editorState, setEditorState] = useState<MaterialSectionState>({
    dirty: false,
    busy: false,
  });
  const reportEditor = useCallback(
    (state: MaterialSectionState) => setEditorState(state),
    [],
  );
  const [pending, setPending] = useState<(() => void) | null>(null);
  const locked = inline && (editorState.busy || !!editorState.uncertain);
  const dirty = inline && editorState.dirty;
  const request = (action: () => void) => {
    if (locked) return;
    if (dirty) setPending(() => action);
    else action();
  };

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    void issuerRegistry.list(c.signal).then((result) => {
      if (!c.signal.aborted) setIssuers(result.items);
    }).catch((e) => {
      if (!c.signal.aborted) {
        setError(
          e instanceof Error ? e.message : "번호 출처를 읽지 못했습니다.",
        );
      }
    }).finally(() => {
      if (!c.signal.aborted) setLoading(false);
    });
    return () => c.abort();
  }, [revision]);
  useEffect(() => {
    const c = new AbortController();
    rulesRequest.current = c;
    setRules(null);
    setRuleError("");
    if (selected) {
      void issuerRegistry.rules(selected, c.signal).then((result) => {
        if (!c.signal.aborted) setRules(result.items);
      }).catch((e) => {
        if (!c.signal.aborted) {
          setRuleError(
            e instanceof Error ? e.message : "번호 종류를 읽지 못했습니다.",
          );
        }
      });
    }
    return () => c.abort();
  }, [selected, ruleRevision]);
  useEffect(() => {
    if (!editing && returnFocus.current) {
      const frame = requestAnimationFrame(() => {
        const target = returnFocus.current;
        if (target?.isConnected) target.focus();
        else addButton.current?.focus();
        returnFocus.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editing]);
  const edit = (target: RegistryEditTarget) => {
    const origin = document.activeElement as HTMLElement;
    request(() => {
      returnFocus.current = origin;
      setEditing(target);
      setMessage("");
    });
  };
  const saved = (row: EntityIssuer | IdentifierRule) => {
    if ("code" in row) {
      setIssuers((current) =>
        current?.some((i) => i.code === row.code)
          ? current.map((i) => i.code === row.code ? row : i)
          : [...(current ?? []), row]
      );
      setSelected(row.code);
      setMessage("번호 출처를 저장했습니다.");
      if (editing?.kind === "issuer" && !editing.issuer) {
        setEditing({
          kind: "rule",
          source: row.code,
          sourceLabel: row.label,
          createdIssuer: true,
        });
        return;
      }
    } else {
      rulesRequest.current?.abort();
      setRules((current) =>
        current?.some((r) => r.id === row.id)
          ? current.map((r) => r.id === row.id ? row : r)
          : [...(current ?? []), row]
      );
      setMessage("번호 종류를 저장했습니다.");
    }
    setEditing(null);
  };
  const renderEditor = (target: RegistryEditTarget, inline = false) => (
    <IssuerRegistryEditor
      key={target.kind === "issuer"
        ? `issuer:${target.issuer?.code ?? "new"}`
        : `rule:${target.source}:${target.rule?.id ?? "new"}`}
      target={target}
      inline={inline}
      onState={inline ? reportEditor : undefined}
      onClose={() => inline ? request(() => setEditing(null)) : setEditing(null)}
      onSaved={saved}
      onDeleted={() => {
        if (target.kind === "issuer") {
          setSelected("");
          setRevision((v) => v + 1);
        } else setRuleRevision((v) => v + 1);
        setEditing(null);
        setMessage("삭제했습니다.");
      }}
    />
  );
  return (
    <section
      className="min-w-0 flex w-full flex-col gap-6 max-w-6xl"
      aria-label="번호 설정"
    >
      <MaterialSettingsHeading section="numbers" />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">번호 출처</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline"
            type="button"
           
            ref={addButton}
            disabled={loading || locked}
            onClick={() => edit({ kind: "issuer" })}
          >
            <BodyActionFace icon="create">번호 출처 추가</BodyActionFace>
          </Button>
        </div>
      </div>
      {loading && <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>}
      {error && (
        <Alert variant="destructive" role="alert"><AlertDescription>
          {error}
          <BodyAction icon="reset" onClick={() => setRevision((v) => v + 1)}>
            다시 조회
          </BodyAction>
        </AlertDescription></Alert>
      )}
      {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
      {issuers?.length === 0 && !loading && !error && <p className="text-sm text-muted-foreground">번호 출처가 없습니다.</p>}
      <div className="flex min-w-0 flex-col gap-4">
        {issuers?.map((issuer) => (
          <IssuerRow
            key={issuer.code}
            label={issuer.label}
            open={selected === issuer.code}
            summary={!issuer.active ? "사용 중지" : issuer.system ? "자동 생성" : undefined}
            disabled={locked}
            action={issuer.system ? undefined : selected !== issuer.code ? <span /> : (
              <BodyAction
                disabled={locked}
                aria-label={`${issuer.label} 편집`}
                onClick={() => edit({ kind: "issuer", issuer })}
              >
                출처 편집
              </BodyAction>
            )}
            onToggle={() => {
              const origin = document.activeElement as HTMLElement;
              request(() => {
                returnFocus.current = origin;
                setEditing(null);
                setSelected((value) => value === issuer.code ? "" : issuer.code);
                setMessage("");
              });
            }}
          >
            {selected === issuer.code && (
              <>
                {rules === null && !ruleError && <Alert role="status"><AlertDescription>불러오는 중…</AlertDescription></Alert>}
                {ruleError && (
                  <Alert variant="destructive" role="alert"><AlertDescription>
                    {ruleError}
                    <BodyAction
                      icon="reset"
                      onClick={() => setRuleRevision((v) => v + 1)}
                    >
                      다시 조회
                    </BodyAction>
                  </AlertDescription></Alert>
                )}
                {rules?.length === 0 && <p className="text-sm text-muted-foreground">등록된 번호 종류가 없습니다.</p>}
                <div className="flex min-w-0 flex-col gap-3">
                  {rules?.map((rule) => {
                    const generation = rule.generation === "automatic" ? "자동 생성" : "직접 입력";
                    const expanded = inline && editing.rule?.id === rule.id;
                    return (
                      <div key={rule.id} className="min-w-0 border-b border-border py-4 last:border-b-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border py-3">
                          {!expanded && (
                            <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3 flex-1">
                              <div>
                                <dt>번호 종류 이름</dt>
                                <dd>{rule.label}</dd>
                              </div>
                              {rule.label !== generation && (
                                <div>
                                  <dt>입력 방식</dt>
                                  <dd>{generation}</dd>
                                </div>
                              )}
                              <div>
                                <dt>사용</dt>
                                <dd>{rule.active ? "사용 중" : "사용 중지"}</dd>
                              </div>
                            </dl>
                          )}
                          {!issuer.system && (
                            <BodyAction
                             
                              aria-label={`${rule.label} 편집`}
                              aria-expanded={expanded}
                              aria-controls={`${ruleListId}-${rule.id}`}
                              disabled={locked}
                              onClick={() =>
                                expanded ? request(() => setEditing(null)) : edit({
                                  kind: "rule",
                                  source: issuer.code,
                                  sourceLabel: issuer.label,
                                  rule,
                                })}
                            >
                              {expanded ? "접기" : "편집"}
                            </BodyAction>
                          )}
                        </div>
                        <div id={`${ruleListId}-${rule.id}`}>
                          {expanded && editing && renderEditor(editing, true)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!issuer.system && (
                  <div>
                    <BodyAction
                      icon="create"
                      disabled={rules === null || !issuer.active || locked}
                      onClick={() =>
                        edit({
                          kind: "rule",
                          source: issuer.code,
                          sourceLabel: issuer.label,
                        })}
                    >
                      번호 종류 추가
                    </BodyAction>
                  </div>
                )}
              </>
            )}
          </IssuerRow>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        실제 상품 번호·주문 번호 값은 각 자료에 입력합니다.
      </p>
      {editing && !inline && renderEditor(editing)}
      {inline && <InlineNumberNavigationGuard dirty={dirty} locked={locked} />}
      <ConfirmDialog
        open={!locked && !!pending}
        title="변경을 버릴까요?"
        message="저장하지 않은 번호 설정이 사라집니다."
        confirmLabel="변경 버리기"
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          setPending(null);
          pending?.();
        }}
      />
    </section>
  );
}

/** Only the inline editor registers a route guard; modal editors own their own guard. */
function InlineNumberNavigationGuard(
  { dirty, locked }: { dirty: boolean; locked: boolean },
) {
  const blocker = usePageNavigationBlocker(dirty, locked);
  useEffect(() => {
    if (locked && blocker.state === "blocked") blocker.reset();
  }, [locked, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || locked) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, locked]);
  return (
    <ConfirmDialog
      open={!locked && blocker.state === "blocked"}
      title="변경을 버릴까요?"
      message="저장하지 않은 번호 설정이 사라집니다."
      confirmLabel="변경 버리기"
      onCancel={() => {
        if (blocker.state === "blocked") blocker.reset();
      }}
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
    />
  );
}
