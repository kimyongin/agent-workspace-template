import { PageHeading } from "../../components/PageHeading.tsx";
import { useEffect, useRef, useState } from "react";
import { useBlocker, useLocation } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { NavigationRowActions } from "./NavigationRowActions.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { defaultNavigationRefs, type NavigationRef, resolveNavigationRefs } from "../../app/type-navigation.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ProfileDisplayRefreshError } from "../auth/profile-client.ts";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { EntityTypeIcon } from "../entity/EntityTypeIcon.tsx";
import { accountPreferences, type NavigationPreference } from "./account-preferences.ts";
import { useNavigationPreview } from "./navigation-preview.tsx";
import "./settings.css";
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
  const addSelect = useRef<HTMLSelectElement>(null);
  const { setPreview } = useNavigationPreview();
  const location = useLocation();
  const catalog = useEntityTypes(location.key);
  const types = catalog.types ?? [];
  const dirty = !equal(draft, baseline);
  const refs = draft?.refs ?? defaultNavigationRefs(types);
  const choices = resolveNavigationRefs([
    ...["entities", "tasks", "principles", "records"].map((id) => ({ kind: "builtin", id } as NavigationRef)),
    ...types.map((type) => ({ kind: "type" as const, id: type.id })),
  ], types);
  const available = choices.filter((entry) => !refs.some((ref) => key(ref) === entry.key));
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
      className={inline ? "settings-section navigation-settings" : "panel settings navigation-settings"}
      id="settings-navigation"
      aria-label="메뉴 바로가기"
    >
      {inline && (
        <div className="navigation-settings-heading">
          <h2 className="settings-section-title">메뉴 바로가기</h2>
          <span className="secondary" aria-label={`${refs.length}개 선택, 최대 4개`}>{refs.length}/4</span>
        </div>
      )}
      {!inline && (
        <>
          <nav className="settings-breadcrumb" aria-label="설정 경로">
            <DetailLink to="/settings">설정</DetailLink>
            <span>메뉴 바로가기</span>
          </nav>
          <PageHeading title="메뉴 바로가기" id="navigation-settings-title" description="자주 쓰는 화면을 골라 메뉴에 표시하고 순서를 정합니다." />
        </>
      )}
      <form
        className="form"
        aria-label="메뉴 바로가기 설정"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="settings-fields" disabled={busy}>
          <ol className="navigation-selection" aria-label="선택한 바로가기">
            {refs.map((ref, index) => {
              const entry = resolveNavigationRefs([ref], types)[0];
              const label = entry?.label ?? "사용할 수 없는 자료 종류";
              return (
                <li key={key(ref)}>
                  <span className="navigation-selection-label">
                    <EntityTypeIcon id={entry?.icon ?? "box"} />
                    {label}
                    {entry?.archived ? " · 보관" : ""}
                    {!entry ? catalog.types === null && !catalog.error ? " · 확인 중" : " · 참조 유지" : ""}
                  </span>
                  <NavigationRowActions
                    label={label}
                    index={index}
                    count={refs.length}
                    onMove={(direction) => {
                      const next = [...refs];
                      [next[index + direction], next[index]] = [next[index], next[index + direction]];
                      edit(next);
                    }}
                    onRemove={(event) => {
                      const row = event.currentTarget.closest("li");
                      const next = (row?.nextElementSibling ?? row?.previousElementSibling)
                        ?.querySelector<HTMLButtonElement>('button[title="바로가기에서 제거"]');
                      edit(refs.filter((_, position) => position !== index));
                      requestAnimationFrame(() => (next ?? addSelect.current)?.focus());
                    }}
                  />
                </li>
              );
            })}
          </ol>
          {refs.length === 0 && <p className="secondary">내 프로필만 표시합니다.</p>}
          <div className="navigation-add-row">
            <select
              ref={addSelect}
              className="input"
              aria-label="추가할 메뉴"
              value={selected?.key ?? ""}
              disabled={refs.length >= 4 || available.length === 0}
              onChange={(event) => setCandidate(event.target.value)}
            >
              <option value="">
                {refs.length >= 4 ? "최대 4개 선택" : available.length ? "메뉴 선택" : "추가할 메뉴 없음"}
              </option>
              {available.map((entry) => (
                <option key={entry.key} value={entry.key}>{entry.label}{entry.archived ? " · 보관" : ""}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={refs.length >= 4 || !selected}
              aria-label={selected ? `${selected.label} 추가` : "메뉴 추가"}
              onClick={() => {
                if (!selected || refs.length >= 4) return;
                edit([...refs, selected.ref]);
                setCandidate("");
              }}
            >
              추가
            </button>
          </div>
          {catalog.error && (
            <div role="alert" className="notice notice-error">
              자료 종류를 불러오지 못했습니다. 저장된 참조는 유지됩니다.{" "}
              <button type="button" className="btn" onClick={catalog.retry}>다시 시도</button>
            </div>
          )}
        </fieldset>
        {conflict && (
          <div role="alert" className="notice notice-error">
            <p>
              다른 탭에서 메뉴 설정이 변경되었습니다. 선택한 미리보기는 유지했습니다. 최신 설정을 확인하고 계속하세요.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setBaseline(saved);
                  setDraft(saved);
                  setConflict(false);
                }}
              >
                최신 설정 사용
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setBaseline(saved);
                  setConflict(false);
                }}
              >
                현재 선택 유지
              </button>
            </div>
          </div>
        )}
        {message && (
          <p role={message.error ? "alert" : "status"} className={message.error ? "error-text" : "secondary"}>
            {message.text}
          </p>
        )}
        <div className="settings-section-footer navigation-settings-footer">
          <BodyAction
            icon="reset"
            disabled={draft === null || busy}
            onClick={() => {
              setDraft(null);
              setMessage(null);
            }}
          >
            기본 구성 사용
          </BodyAction>
          <div className="actions">
            <button
              type="button"
              className="btn"
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
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!dirty || busy || conflict}
              aria-label="메뉴 바로가기 저장"
            >
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </form>
      {!inline && <NavigationSettingsProtection dirty={dirty} busy={busy} />}
    </section>
  );
}

function NavigationSettingsProtection({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  const blocker = useBlocker(dirty || busy);
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
