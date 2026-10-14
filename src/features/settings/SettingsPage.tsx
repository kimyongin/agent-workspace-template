import { NavigationSettings } from "./NavigationSettingsPage.tsx";
import { SettingsNavigation } from "./SettingsNavigation.tsx";
import { Field } from "../../components/Field.tsx";
import { browserTimezone, timezoneOptions } from "../../lib/timezone.ts";
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ProfileDisplayRefreshError } from "../auth/profile-client.ts";
import { ProfileIcon } from "./profile.tsx";
import {
  type AccountPreferences,
  accountPreferences,
  displayScalePreference,
  displayScales,
  profileIcons,
  profileName,
} from "./account-preferences.ts";
import "./settings.css";
import { useDisplayScalePreview } from "./display-scale.tsx";

const preferenceSections = {
  profile: { title: "프로필", keys: ["icon", "nickname"] },
  date: { title: "날짜와 시각", keys: ["timezone"] },
  display: { title: "화면 표시", keys: ["desktopDisplayScale", "mobileDisplayScale"] },
} as const;
type PreferenceSection = keyof typeof preferenceSections;

export function SettingsPage() {
  const { session } = useAuth();
  return session ? <AccountSettings key={session.user.id} /> : null;
}
function AccountSettings() {
  const { session, savePreferences } = useAuth();
  const metadata = session!.user.user_metadata;
  const preferences = accountPreferences(metadata);
  const saved = { ...preferences, nickname: preferences.nickname ?? "" };
  const [draft, setDraft] = useState(saved);
  useDisplayScalePreview(draft.desktopDisplayScale, draft.mobileDisplayScale);
  const [navigationState, setNavigationState] = useState({ dirty: false, busy: false });
  const [saving, setSaving] = useState<PreferenceSection | null>(null);
  const [messages, setMessages] = useState<Partial<Record<PreferenceSection, { text: string; error?: boolean }>>>({});
  const pending = useRef(false), mounted = useRef(true), previousSaved = useRef(saved);
  const isDirty = (section: PreferenceSection) =>
    preferenceSections[section].keys.some((key) => draft[key] !== saved[key]);
  const dirty = Object.keys(preferenceSections).some((section) => isDirty(section as PreferenceSection));
  useEffect(() => {
    const previous = previousSaved.current;
    previousSaved.current = saved;
    setDraft((value) => ({
      navigation: saved.navigation,
      icon: value.icon === previous.icon ? saved.icon : value.icon,
      nickname: value.nickname === previous.nickname ? saved.nickname : value.nickname,
      timezone: value.timezone === previous.timezone ? saved.timezone : value.timezone,
      desktopDisplayScale: value.desktopDisplayScale === previous.desktopDisplayScale
        ? saved.desktopDisplayScale
        : value.desktopDisplayScale,
      mobileDisplayScale: value.mobileDisplayScale === previous.mobileDisplayScale
        ? saved.mobileDisplayScale
        : value.mobileDisplayScale,
    }));
  }, [saved.icon, saved.nickname, saved.timezone, saved.desktopDisplayScale, saved.mobileDisplayScale]);
  const anyBusy = saving !== null || navigationState.busy;
  const anyDirty = dirty || navigationState.dirty;
  const blocker = useBlocker(anyDirty || anyBusy);
  useEffect(() => {
    if (anyBusy && blocker.state === "blocked") blocker.reset();
  }, [anyBusy, blocker]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (anyDirty || anyBusy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [anyDirty, anyBusy]);
  const clearMessage = (section: PreferenceSection) => setMessages((current) => ({ ...current, [section]: undefined }));
  const saveSection = async (section: PreferenceSection) => {
    if (pending.current || !isDirty(section)) return;
    pending.current = true;
    setSaving(section);
    clearMessage(section);
    const changes: Partial<AccountPreferences> = {};
    for (const key of preferenceSections[section].keys) {
      if (draft[key] !== saved[key]) Object.assign(changes, { [key]: draft[key] });
    }
    try {
      const confirmed = await savePreferences(changes);
      if (mounted.current) {
        // A save owns only its section; preserve unsaved input in every other section.
        setDraft((current) => ({
          ...current,
          ...Object.fromEntries(
            preferenceSections[section].keys.map(
              (key) => [key, key === "nickname" ? confirmed[key] ?? "" : confirmed[key]],
            ),
          ),
        }));
        setMessages((current) => ({ ...current, [section]: { text: "설정을 저장했습니다." } }));
      }
    } catch (cause) {
      if (mounted.current) {
        setMessages((current) => ({
          ...current,
          [section]: {
            error: true,
            text: cause instanceof ProfileDisplayRefreshError
              ? cause.message
              : "저장하지 못했습니다. 입력한 설정을 유지했습니다. 다시 시도하세요.",
          },
        }));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(null);
    }
  };
  const controls = (section: PreferenceSection) => (
    <div className="settings-section-footer">
      {messages[section] && (
        <p
          className={messages[section]?.error ? "error-text" : "secondary"}
          role={messages[section]?.error ? "alert" : "status"}
        >
          {messages[section]?.text}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={!isDirty(section) || saving !== null}
          onClick={() => {
            setDraft((current) => ({
              ...current,
              ...Object.fromEntries(preferenceSections[section].keys.map((key) => [key, saved[key]])),
            }));
            clearMessage(section);
          }}
        >
          변경 취소
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          aria-label={`${preferenceSections[section].title} 저장`}
          disabled={!isDirty(section) || saving !== null}
        >
          {saving === section ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
  const profile = (
    <>
      <div className="profile-preview">
        <ProfileIcon id={draft.icon} />
        <span className="account-name">{profileName({ ...metadata, workspace_nickname: draft.nickname })}</span>
      </div>
      <Field label="닉네임">
        {(props) => (
          <input
            {...props}
            className="input"
            type="text"
            maxLength={40}
            autoComplete="nickname"
            value={draft.nickname}
            placeholder={profileName({ ...metadata, workspace_nickname: null })}
            onChange={(event) => {
              setDraft((value) => ({ ...value, nickname: event.target.value }));
              clearMessage("profile");
            }}
          />
        )}
      </Field>
      <fieldset className="profile-icon-field">
        <legend className="label">프로필 아이콘</legend>
        <div className="profile-choices">
          {profileIcons.map((icon) => (
            <label key={icon.id} className="profile-choice" title={icon.label}>
              <input
                type="radio"
                name="profile-icon"
                value={icon.id}
                aria-label={icon.label}
                checked={draft.icon === icon.id}
                onChange={() => {
                  setDraft((value) => ({ ...value, icon: icon.id }));
                  clearMessage("profile");
                }}
              />
              <ProfileIcon id={icon.id} />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
  const date = (
    <Field label="표시 시간대">
      {(props) => (
        <select
          {...props}
          className="input"
          value={draft.timezone ?? ""}
          onChange={(event) => {
            setDraft((value) => ({ ...value, timezone: event.target.value || null }));
            clearMessage("date");
          }}
        >
          <option value="">기기 시간대 사용 ({browserTimezone()})</option>
          {timezoneOptions(draft.timezone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
      )}
    </Field>
  );
  const display = (
    <div className="field-row">
      {([{ key: "mobileDisplayScale", label: "모바일 화면 배율" }, {
        key: "desktopDisplayScale",
        label: "데스크톱 화면 배율",
      }] as const).map(({ key, label }) => (
        <Field key={key} label={label}>
          {(props) => (
            <select
              {...props}
              className="input"
              value={draft[key]}
              onChange={(event) => {
                setDraft((value) => ({ ...value, [key]: displayScalePreference(event.target.value) }));
                clearMessage("display");
              }}
            >
              {displayScales.map((scale) => (
                <option key={scale} value={scale}>{scale}%{scale === 100 ? " (기본)" : ""}</option>
              ))}
            </select>
          )}
        </Field>
      ))}
    </div>
  );
  return (
    <section className="panel settings" aria-labelledby="settings-title">
      <h1 className="page-title" id="settings-title">기본 설정</h1>
      <SettingsNavigation />
      {(["profile", "date", "display"] as const).map((section) => (
        <section className="settings-section" aria-labelledby={`settings-${section}`} key={section}>
          <h2 id={`settings-${section}`} className="settings-section-title">{preferenceSections[section].title}</h2>
          <form
            className="form"
            aria-label={`${preferenceSections[section].title} 설정`}
            aria-busy={saving === section}
            onSubmit={(event) => {
              event.preventDefault();
              void saveSection(section);
            }}
          >
            <fieldset disabled={saving !== null} className="settings-fields">
              {{ profile, date, display }[section]}
            </fieldset>
            {controls(section)}
          </form>
          {section === "display" && <NavigationSettings inline onStateChange={setNavigationState} />}
        </section>
      ))}
      <ConfirmDialog
        open={!anyBusy && blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message="저장하지 않은 설정이 사라집니다."
        confirmLabel="변경 버리기"
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
    </section>
  );
}
