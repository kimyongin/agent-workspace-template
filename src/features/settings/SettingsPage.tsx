import { EntityIdentitySettings } from "./EntityIdentitySettings.tsx";
import { RecordTemplateSettings } from "./RecordTemplateSettings.tsx";
import { Field } from "../../components/Field.tsx";
import { browserTimezone, timezoneOptions } from "../../lib/timezone.ts";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ProfileDisplayRefreshError } from "../auth/profile-client.ts";
import { ProfileIcon } from "./profile.tsx";
import { accountPreferences, displayScales, displayScalePreference, profileIcons, profileName, type AccountPreferences } from "./account-preferences.ts";
import { useDisplayScalePreview } from "./display-scale.tsx";

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
  const [identityState, setIdentityState] = useState({dirty:false,busy:false});
  const [businessState, setBusinessState] = useState({dirty:false,busy:false});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const previousSaved = useRef(saved);
  const dirty = draft.icon !== saved.icon || draft.nickname !== saved.nickname || draft.timezone !== saved.timezone || draft.desktopDisplayScale !== saved.desktopDisplayScale || draft.mobileDisplayScale !== saved.mobileDisplayScale;
  useEffect(() => {
    const previous = previousSaved.current;
    previousSaved.current = saved;
    // 같은 계정의 외부 갱신은 수정하지 않은 필드에만 반영한다.
    setDraft(value => ({
      icon: value.icon === previous.icon ? saved.icon : value.icon,
      nickname: value.nickname === previous.nickname ? saved.nickname : value.nickname,
      timezone: value.timezone === previous.timezone ? saved.timezone : value.timezone,
      desktopDisplayScale: value.desktopDisplayScale === previous.desktopDisplayScale ? saved.desktopDisplayScale : value.desktopDisplayScale,
      mobileDisplayScale: value.mobileDisplayScale === previous.mobileDisplayScale ? saved.mobileDisplayScale : value.mobileDisplayScale,
    }));
  }, [saved.icon, saved.nickname, saved.timezone, saved.desktopDisplayScale, saved.mobileDisplayScale]);
  const blocker = useBlocker(dirty || busy || businessState.dirty || businessState.busy || identityState.dirty || identityState.busy);
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  const clearMessage = () => { setMessage(""); setError(false); };
  return <section className="panel settings" aria-labelledby="settings-title">
    <h1 className="page-title" id="settings-title">설정</h1>
    <form className="account-settings-form" aria-label="계정 설정" onSubmit={async event => {
      event.preventDefault(); if (pending.current || !dirty) return;
      pending.current = true; setBusy(true); clearMessage();
      const changes: Partial<AccountPreferences> = {};
      // 변경한 필드만 보내 다른 탭에서 저장한 나머지 필드를 덮지 않는다.
      if (draft.icon !== saved.icon) changes.icon = draft.icon;
      if (draft.nickname !== saved.nickname) changes.nickname = draft.nickname;
      if (draft.timezone !== saved.timezone) changes.timezone = draft.timezone;
      if (draft.desktopDisplayScale !== saved.desktopDisplayScale) changes.desktopDisplayScale = draft.desktopDisplayScale;
      if (draft.mobileDisplayScale !== saved.mobileDisplayScale) changes.mobileDisplayScale = draft.mobileDisplayScale;
      try {
        const confirmed = await savePreferences(changes);
        if (mounted.current) { setDraft({ ...confirmed, nickname: confirmed.nickname ?? "" }); setMessage("설정을 저장했습니다."); }
      } catch (cause) {
        if (mounted.current) { setError(true); setMessage(cause instanceof ProfileDisplayRefreshError ? cause.message : "저장하지 못했습니다. 입력한 설정을 유지했습니다. 다시 시도하세요."); }
      } finally { pending.current = false; if (mounted.current) setBusy(false); }
    }} aria-busy={busy}>
      <fieldset disabled={busy} className="settings-group"><legend className="section-title">프로필</legend>
        <div className="settings-fields">
        <div className="profile-preview"><ProfileIcon id={draft.icon} /><span className="account-name">{profileName({ ...metadata, workspace_nickname: draft.nickname })}</span></div>
        <Field label="닉네임">{props => <input {...props} className="input" type="text" maxLength={40} autoComplete="nickname" value={draft.nickname} placeholder={profileName({ ...metadata, workspace_nickname: null })} onChange={event => { setDraft(value => ({ ...value, nickname: event.target.value })); clearMessage(); }} />}</Field>
        <fieldset className="profile-icon-field"><legend className="label">프로필 아이콘</legend>
          <div className="profile-choices">{profileIcons.map(icon => <label key={icon.id} className="profile-choice" title={icon.label}>
            <input type="radio" name="profile-icon" value={icon.id} aria-label={icon.label} checked={draft.icon === icon.id} onChange={() => { setDraft(value => ({ ...value, icon: icon.id })); clearMessage(); }} /><ProfileIcon id={icon.id} />
          </label>)}</div>
        </fieldset>
        </div>
      </fieldset>
      <fieldset disabled={busy} className="settings-group"><legend className="section-title">날짜와 시각</legend>
        <div className="settings-fields">
        <Field label="표시 시간대">{props => <select {...props} className="input" value={draft.timezone ?? ""} onChange={event => { setDraft(value => ({ ...value, timezone: event.target.value || null })); clearMessage(); }}>
          <option value="">기기 시간대 사용 ({browserTimezone()})</option>
          {timezoneOptions(draft.timezone).map(zone => <option key={zone} value={zone}>{zone}</option>)}
        </select>}</Field>
        </div>
      </fieldset>
      <fieldset disabled={busy} className="settings-group"><legend className="section-title">화면 표시</legend>
        <div className="settings-fields">
          {([{ key: "mobileDisplayScale", label: "모바일 화면 배율" }, { key: "desktopDisplayScale", label: "데스크톱 화면 배율" }] as const).map(({ key, label }) =>
            <Field key={key} label={label}>{props => <select {...props} className="input" value={draft[key]} onChange={event => { setDraft(value => ({ ...value, [key]: displayScalePreference(event.target.value) })); clearMessage(); }}>
              {displayScales.map(scale => <option key={scale} value={scale}>{scale}%{scale === 100 ? " (기본)" : ""}</option>)}
            </select>}</Field>)}
          <p className="secondary">현재 화면 크기의 배율을 미리 봅니다. 저장하면 다음 로그인에도 적용됩니다.</p>
        </div>
      </fieldset>
    <section className="settings-group" aria-labelledby="data-title"><h2 className="section-title" id="data-title">자료 관리</h2>
      <div className="settings-links"><DetailLink to="/tags/entity">엔터티 태그</DetailLink><DetailLink to="/tags/task">할 일 태그</DetailLink><DetailLink to="/tags/record">기록 태그</DetailLink></div></section>
      <div className="settings-save"><p className={error ? "error-text" : "secondary"} role={error ? "alert" : "status"}>{message}</p>
        <div className="actions"><button type="button" className="btn" disabled={!dirty || busy} onClick={() => { setDraft(saved); clearMessage(); }}>변경 취소</button>
          <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>{busy ? "저장 중…" : "저장"}</button></div>
      </div>
    </form>
    <RecordTemplateSettings onStateChange={setBusinessState} />
    <EntityIdentitySettings onStateChange={setIdentityState} />
    <ConfirmDialog open={!busy && blocker.state === "blocked"} title="변경을 버릴까요?" message="저장하지 않은 설정이 사라집니다." confirmLabel="변경 버리기"
      onConfirm={() => { if (blocker.state === "blocked") blocker.proceed(); }} onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }} />
  </section>;
}
