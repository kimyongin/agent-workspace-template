import { Field } from "../../components/Field.tsx";
import { browserTimezone, timezoneOptions, timezonePreference } from "../../lib/timezone.ts";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ProfileDisplayRefreshError } from "../auth/profile-client.ts";
import { ProfileIcon, profileIconId, profileIcons, type ProfileIconId } from "./profile.tsx";

export function SettingsPage() {
  const { session } = useAuth();
  return session ? <AccountSettings key={session.user.id} /> : null;
}
function AccountSettings() {
  const { session, saveProfileIcon, saveTimezone } = useAuth();
  const saved = profileIconId(session?.user.user_metadata?.workspace_avatar_id);
  const [draft, setDraft] = useState<ProfileIconId>(saved);
  const savedTimezone = timezonePreference(session?.user.user_metadata?.workspace_timezone);
  const [timezone, setTimezone] = useState<string | null>(savedTimezone);
  const [timezoneMessage, setTimezoneMessage] = useState("");
  const [timezoneError, setTimezoneError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const previousSaved = useRef(saved);
  const iconDirty = draft !== saved;
  const timezoneDirty = timezone !== savedTimezone;
  const dirty = iconDirty || timezoneDirty;
  const previousTimezone = useRef(savedTimezone);
  useEffect(() => {
    const previous = previousTimezone.current; previousTimezone.current = savedTimezone;
    setTimezone(value => value === previous ? savedTimezone : value);
  }, [savedTimezone]);
  const blocker = useBlocker(dirty || busy);
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  useEffect(() => {
    const previous = previousSaved.current;
    previousSaved.current = saved;
    setDraft(value => value === previous ? saved : value);
  }, [saved]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  const user = session!.user;
  const select = (id: ProfileIconId) => { setDraft(id); setMessage(""); setError(false); };
  return <section className="panel settings" aria-labelledby="settings-title">
    <h1 className="page-title" id="settings-title">설정</h1>
    <section aria-labelledby="account-title"><h2 className="section-title" id="account-title">내 계정</h2>
      <p className="account-name">{typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "내 계정"}</p><p className="secondary">{user.email}</p></section>
    <form aria-label="프로필 아이콘 설정" onSubmit={async event => {
      event.preventDefault(); if (pending.current || !iconDirty) return;
      pending.current = true; setBusy(true); setMessage(""); setError(false);
      try {
        const confirmed = await saveProfileIcon(draft);
        if (mounted.current) { setDraft(confirmed); setMessage("프로필 아이콘을 저장했습니다."); }
      }
      catch (cause) { if (mounted.current) { setError(true); setMessage(cause instanceof ProfileDisplayRefreshError ? cause.message : "저장하지 못했습니다. 선택한 아이콘을 유지했습니다. 다시 시도하세요."); } }
      finally { pending.current = false; if (mounted.current) setBusy(false); }
    }} aria-busy={busy}>
      <fieldset disabled={busy}><legend className="section-title">프로필 아이콘</legend>
        <div className="profile-preview"><ProfileIcon id={draft} /><span className="secondary">선택한 아이콘 미리보기</span></div>
        <div className="profile-choices">{profileIcons.map(icon => <label key={icon.id} className="profile-choice">
          <input type="radio" name="profile-icon" value={icon.id} checked={draft === icon.id} onChange={() => select(icon.id)} /><ProfileIcon id={icon.id} /><span>{icon.label}</span>
        </label>)}</div>
        <div className="actions"><button type="button" className="btn btn-text" onClick={() => select("person")}>기본값 선택</button>
          <button type="button" className="btn btn-text" disabled={!iconDirty} onClick={() => select(saved)}>변경 취소</button>
          <button type="submit" className="btn btn-primary" disabled={!iconDirty || busy}>{busy ? "저장 중…" : "아이콘 저장"}</button></div>
      </fieldset><p className={error ? "error-text" : "secondary"} role={error ? "alert" : "status"}>{message}</p>
    </form>
    <form className="timezone-settings" aria-label="날짜와 시각 설정" onSubmit={async event => {
      event.preventDefault(); if (pending.current || !timezoneDirty) return;
      pending.current = true; setBusy(true); setTimezoneMessage(""); setTimezoneError(false);
      try {
        const confirmed = await saveTimezone(timezone);
        if (mounted.current) { setTimezone(confirmed); setTimezoneMessage("표시 시간대를 저장했습니다."); }
      } catch (cause) {
        if (mounted.current) { setTimezoneError(true); setTimezoneMessage(cause instanceof ProfileDisplayRefreshError ? cause.message : "저장하지 못했습니다. 선택한 시간대를 유지했습니다. 다시 시도하세요."); }
      } finally { pending.current = false; if (mounted.current) setBusy(false); }
    }} aria-busy={busy}>
      <fieldset disabled={busy}><legend className="section-title">날짜와 시각</legend>
        <Field label="표시 시간대">{props => <select {...props} className="input" value={timezone ?? ""} onChange={event => { setTimezone(event.target.value || null); setTimezoneMessage(""); setTimezoneError(false); }}>
          <option value="">기기 시간대 사용 ({browserTimezone()})</option>
          {timezoneOptions(timezone).map(zone => <option key={zone} value={zone}>{zone}</option>)}
        </select>}</Field>
        <div className="actions"><button type="button" className="btn btn-text" disabled={!timezoneDirty} onClick={() => { setTimezone(savedTimezone); setTimezoneMessage(""); setTimezoneError(false); }}>시간대 변경 취소</button>
          <button type="submit" className="btn btn-primary" disabled={!timezoneDirty || busy}>시간대 저장</button></div>
      </fieldset><p className={timezoneError ? "error-text" : "secondary"} role={timezoneError ? "alert" : "status"}>{timezoneMessage}</p>
    </form>
    <section aria-labelledby="data-title"><h2 className="section-title" id="data-title">자료 관리</h2>
      <div className="actions"><DetailLink className="btn" to="/tags/entity">엔터티 태그 관리</DetailLink><DetailLink className="btn" to="/tags/task">할 일 태그 관리</DetailLink><DetailLink className="btn" to="/tags/record">기록 태그 관리</DetailLink></div></section>
    <section aria-labelledby="connection-title"><h2 className="section-title" id="connection-title">에이전트 연결</h2>
      <Link className="btn btn-text" to="/guide">연결 안내 보기</Link></section>
    <Link className="btn btn-text" to="/logout">로그아웃</Link>
    <ConfirmDialog open={!busy && blocker.state === "blocked"} title="변경을 버릴까요?" message="저장하지 않은 설정이 사라집니다." confirmLabel="변경 버리기"
      onConfirm={() => { if (blocker.state === "blocked") blocker.proceed(); }} onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }} />
  </section>;
}
