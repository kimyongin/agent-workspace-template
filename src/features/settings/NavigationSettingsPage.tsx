import { BusinessCell, BusinessRow, BusinessTable } from "../../components/BusinessTable.tsx";
import { RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Button } from "../../components/ui/button.tsx";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { PageHeading } from "../../components/PageHeading.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";

import { NavigationRowActions } from "./NavigationRowActions.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { defaultNavigationRefs, type NavigationRef, resolveNavigationRefs } from "../../app/type-navigation.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ProfileDisplayRefreshError } from "../auth/profile-client.ts";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
import { accountPreferences, type NavigationPreference } from "./account-preferences.ts";
import { useNavigationPreview } from "./navigation-preview.tsx";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (ref: NavigationRef) => `${ref.kind}:${ref.id}`;
export function NavigationSettingsPage() {
  const { session } = useAuth();
  return session ? <NavigationSettings key={session.user.id} /> : null;
}
export function NavigationSettings(
  { inline = false, onStateChange }: {
    inline?: boolean;
    onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  },
) {
  const { session, savePreferences } = useAuth();
  const saved = accountPreferences(session!.user.user_metadata).navigation;
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [candidate, setCandidate] = useState("");
  const pending = useRef(false), mounted = useRef(true);
  const addSelect = useRef<HTMLInputElement>(null);
  const { setPreview } = useNavigationPreview();
  const location = useLocation();
  const catalog = useEntityTypes(location.key);
  const types = useMemo(() => catalog.types ?? [], [catalog.types]);
  const dirty = !equal(draft, baseline);
  const refs = useMemo(() => draft?.refs ?? defaultNavigationRefs(types), [draft, types]);
  const choices = useMemo(() => resolveNavigationRefs([
    ...["entities", "tasks", "records"].map((id) => ({ kind: "builtin", id } as NavigationRef)),
    ...types.map((type) => ({ kind: "type" as const, id: type.id })),
  ], types), [types]);
  const available = useMemo(() => choices.filter((entry) => !refs.some((ref) => key(ref) === entry.key)), [choices, refs]);
  const selected = available.find((entry) => entry.key === candidate);
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (equal(saved, baseline)) return;
    if (dirty || pending.current) setConflict(true);
    else {
      setBaseline(saved);
      setDraft(saved);
    }
  }, [JSON.stringify(saved)]);
  useEffect(() => {
    setPreview(draft);
    return () => setPreview(undefined);
  }, [draft, setPreview]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  const edit = (next: NavigationRef[]) => {
    setDraft({ version: 1, refs: next });
    setMessage(null);
  };
  const save = async () => {
    if (pending.current || !dirty || conflict) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const confirmed = await savePreferences({ navigation: draft });
      if (mounted.current) {
        setBaseline(confirmed.navigation);
        setDraft(confirmed.navigation);
        setConflict(false);
        setMessage({ text: "메뉴 설정을 저장했습니다." });
      }
    } catch (cause) {
      if (mounted.current) {
        setMessage({
          error: true,
          text: cause instanceof ProfileDisplayRefreshError
            ? cause.message
            : "저장하지 못했습니다. 선택한 메뉴를 유지했습니다. 다시 시도하세요.",
        });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section
      className={inline ? "flex min-w-0 flex-col gap-4" : "min-w-0 flex w-full flex-col gap-6"}
      id="settings-navigation"
      aria-label="메뉴 바로가기"
    >
      <Card>
      <CardHeader>
      {inline && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle><h2>메뉴 바로가기</h2></CardTitle>
          <span className="text-sm text-muted-foreground" aria-label={`${refs.length}개 선택, 최대 4개`}>{refs.length}/4</span>
        </div>
      )}
      {!inline && (
        <>
          <nav className="flex flex-wrap items-center gap-2" aria-label="설정 경로">
            <DetailLink to="/settings">설정</DetailLink>
            <span>메뉴 바로가기</span>
          </nav>
          <PageHeading title="메뉴 바로가기" id="navigation-settings-title" description="자주 쓰는 화면을 골라 메뉴에 표시하고 순서를 정합니다." />
        </>
      )}
      </CardHeader>
      <CardContent>
      <form
        className="flex min-w-0 flex-col gap-5"
        aria-label="메뉴 바로가기 설정"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FieldSet className="min-w-0" disabled={busy}>
          <BusinessTable disclosureColumn={false} label="선택한 바로가기" columns={["메뉴", "순서와 표시"]}>
            {refs.map((ref, index) => {
              const entry = resolveNavigationRefs([ref], types)[0];
              const label = entry?.label ?? "사용할 수 없는 자료 종류";
              return (
                <BusinessRow key={key(ref)}>
                  <BusinessCell index={0}>
                  <span className="flex min-w-0 flex-1 items-center gap-2 [overflow-wrap:anywhere]">
                    <EntityTypeIcon id={entry?.icon ?? "box"} />
                    {label}
                    {entry?.archived ? " · 보관" : ""}
                    {!entry ? catalog.types === null && !catalog.error ? " · 확인 중" : " · 참조 유지" : ""}
                  </span>
                  </BusinessCell>
                  <BusinessCell index={1}><NavigationRowActions
                    label={label}
                    index={index}
                    count={refs.length}
                    onMove={(direction) => {
                      const next = [...refs];
                      [next[index + direction], next[index]] = [next[index], next[index + direction]];
                      edit(next);
                    }}
                    onRemove={(event) => {
                      const row = event.currentTarget.closest("tr");
                      const next = (row?.nextElementSibling ?? row?.previousElementSibling)
                        ?.querySelector<HTMLButtonElement>('button[title="바로가기에서 제거"]');
                      edit(refs.filter((_, position) => position !== index));
                      requestAnimationFrame(() => (next ?? addSelect.current)?.focus());
                    }}
                  /></BusinessCell>
                </BusinessRow>
              );
            })}
          </BusinessTable>
          {refs.length === 0 && <p className="text-sm text-muted-foreground">바로가기를 표시하지 않습니다.</p>}
          <div className="flex flex-wrap items-end gap-3">
            <Combobox items={available} value={selected ?? null} isItemEqualToValue={(a,b) => a.key === b.key} itemToStringLabel={entry => entry.label} onValueChange={entry => setCandidate(entry?.key ?? "")} disabled={busy || refs.length >= 4 || available.length === 0}>
              <ComboboxInput ref={addSelect} aria-label="추가할 메뉴" placeholder={refs.length >= 4 ? "최대 4개 선택" : available.length ? "메뉴 선택" : "추가할 메뉴 없음"} />
              <ComboboxContent><ComboboxEmpty>추가할 메뉴가 없습니다.</ComboboxEmpty><ComboboxList>{entry => <ComboboxItem key={entry.key} value={entry}>{entry.label}{entry.archived ? " · 보관" : ""}</ComboboxItem>}</ComboboxList></ComboboxContent>
            </Combobox>
            <Button variant="outline"
              type="button"

              disabled={refs.length >= 4 || !selected}
              aria-label={selected ? `${selected.label} 추가` : "메뉴 추가"}
              onClick={() => {
                if (!selected || refs.length >= 4) return;
                edit([...refs, selected.ref]);
                setCandidate("");
              }}
            >
              추가
            </Button>
          </div>
          {catalog.error && (
            <Alert variant="destructive" role="alert"><AlertDescription>
              자료 종류를 불러오지 못했습니다. 저장된 참조는 유지됩니다.{" "}
              <Button variant="outline" type="button"  onClick={catalog.retry}>다시 시도</Button>
            </AlertDescription></Alert>
          )}
        </FieldSet>
        {conflict && (
          <Alert variant="destructive" role="alert"><AlertDescription>
            <p>
              다른 탭에서 메뉴 설정이 변경되었습니다. 선택한 미리보기는 유지했습니다. 최신 설정을 확인하고 계속하세요.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline"
                type="button"

                disabled={busy}
                onClick={() => {
                  setBaseline(saved);
                  setDraft(saved);
                  setConflict(false);
                }}
              >
                최신 설정 사용
              </Button>
              <Button variant="outline"
                type="button"

                disabled={busy}
                onClick={() => {
                  setBaseline(saved);
                  setConflict(false);
                }}
              >
                현재 선택 유지
              </Button>
            </div>
          </AlertDescription></Alert>
        )}
        {message && (
          <Alert role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}><AlertDescription>
            {message.text}
          </AlertDescription></Alert>
        )}
        <div className="flex flex-col gap-3 pt-4">
          <Button variant="ghost" type="button"

            disabled={draft === null || busy}
            onClick={() => {
              setDraft(null);
              setMessage(null);
            }}
          ><RotateCcwIcon data-icon="inline-start" />
            기본 구성 사용
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline"
              type="button"

              aria-label="변경 취소"
              disabled={!dirty && !conflict || busy}
              onClick={() => {
                setBaseline(saved);
                setDraft(saved);
                setConflict(false);
                setMessage(null);
              }}
            >
              취소
            </Button>
            <Button variant="default"
              type="submit"

              disabled={!dirty || busy || conflict}
              aria-label="메뉴 바로가기 저장"
            >
              {busy ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      </form>
      {!inline && <NavigationSettingsProtection dirty={dirty} busy={busy} />}
      </CardContent>
      </Card>
    </section>
  );
}

function NavigationSettingsProtection({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  const blocker = usePageNavigationBlocker(dirty, busy);
  useEffect(() => {
    if (busy && blocker.state === "blocked") blocker.reset();
  }, [busy, blocker]);
  return (
    <ConfirmDialog
      open={!busy && blocker.state === "blocked"}
      title="변경을 버릴까요?"
      message="저장하지 않은 메뉴 설정이 사라집니다."
      confirmLabel="변경 버리기"
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
      onCancel={() => {
        if (blocker.state === "blocked") blocker.reset();
      }}
    />
  );
}
