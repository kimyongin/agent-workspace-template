import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, Field as ChoiceField, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Notice } from "../../components/Field.tsx";
import { FieldSet, FieldLegend, FieldLabel } from "@/components/ui/field";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { NavigationSettings } from "./NavigationSettingsPage.tsx";
import { SettingsHeading } from "./SettingsHeading.tsx";
import { Field } from "../../components/Field.tsx";
import { TimezoneSelect } from "../../components/TimezoneSelect.tsx";
import { useEffect, useRef, useState } from "react";
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
  const blocker = usePageNavigationBlocker(anyDirty, anyBusy);
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
    <div className="flex flex-col gap-3 pt-4">
      {messages[section] && (
        <Notice kind={messages[section]?.error ? "error" : "success"}>{messages[section]?.text}</Notice>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline"
          type="button"

          disabled={!isDirty(section) || saving !== null}
          aria-label="변경 취소"
          onClick={() => {
            setDraft((current) => ({
              ...current,
              ...Object.fromEntries(preferenceSections[section].keys.map((key) => [key, saved[key]])),
            }));
            clearMessage(section);
          }}
        >
          취소
        </Button>
        <Button variant="default"
          type="submit"

          aria-label={`${preferenceSections[section].title} 저장`}
          disabled={!isDirty(section) || saving !== null}
        >
          {saving === section ? "저장 중…" : "저장"}
        </Button>
      </div>
    </div>
  );
  const profile = (
    <>
      <Field pair label="닉네임">
        {(props) => (
          <Input
            {...props}

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
      <FieldSet className="col-span-full">
        <FieldLegend className="text-sm font-medium">프로필 아이콘</FieldLegend>
        <RadioGroup aria-label="프로필 아이콘" value={draft.icon} onValueChange={id => { setDraft(value => ({...value, icon: id as AccountPreferences["icon"]})); clearMessage("profile"); }} className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(max(3.5rem,44px),1fr))] gap-2 overflow-auto p-1">
          {profileIcons.map(icon => <FieldLabel key={icon.id} htmlFor={`profile-icon-${icon.id}`} title={icon.label} className="flex min-h-[max(3.5rem,44px)] min-w-[max(2.75rem,44px)] cursor-pointer items-center justify-center gap-2 rounded-lg border border-input p-2 has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-accent">
            <RadioGroupItem id={`profile-icon-${icon.id}`} value={icon.id} aria-label={icon.label} />
            <ProfileIcon id={icon.id} />
          </FieldLabel>)}
        </RadioGroup>
      </FieldSet>
    </>
  );
  const date = (
    <Field pair label="표시 시간대">
      {(props) => (
        <TimezoneSelect
          {...props}
          deviceDefault
          value={draft.timezone ?? ""}
          onChange={(event) => {
            setDraft((value) => ({ ...value, timezone: event.target.value || null }));
            clearMessage("date");
          }}
        />
      )}
    </Field>
  );
  const display = (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
      {([{ key: "mobileDisplayScale", label: "모바일 화면 배율" }, {
        key: "desktopDisplayScale",
        label: "데스크톱 화면 배율",
      }] as const).map(({ key, label }) => (
        <ChoiceField key={key} data-disabled={saving !== null}>
          <FieldTitle id={`display-label-${key}`}>{label}</FieldTitle>
          <ToggleGroup type="single" value={String(draft[key])} disabled={saving !== null} onValueChange={value => { if(value) { setDraft(current => ({...current, [key]: displayScalePreference(value)})); clearMessage("display"); } }} aria-labelledby={`display-label-${key}`} className="flex flex-wrap gap-1">
            {displayScales.map(scale => <ToggleGroupItem key={scale} value={String(scale)}>{scale}%{scale === 100 ? " (기본)" : ""}</ToggleGroupItem>)}
          </ToggleGroup>
        </ChoiceField>
      ))}
    </div>
  );
  return (
    <section className="min-w-0 flex w-full flex-col gap-6 max-w-4xl" aria-labelledby="settings-title">
      <SettingsHeading
        title="기본 설정"
        description="프로필과 날짜·시각, 화면 표시, 메뉴 바로가기를 내게 맞춥니다."
        id="settings-title"
      />

      {(["profile", "date", "display"] as const).map((section) => (
        <Card role="region" aria-labelledby={`settings-${section}`} key={section}>
          <CardHeader><CardTitle><h2 id={`settings-${section}`}>{preferenceSections[section].title}</h2></CardTitle></CardHeader>
          <CardContent>
          <form
            className="flex min-w-0 flex-col gap-5"
            aria-label={`${preferenceSections[section].title} 설정`}
            aria-busy={saving === section}
            onSubmit={(event) => {
              event.preventDefault();
              void saveSection(section);
            }}
          >
            <FieldSet disabled={saving !== null} className="min-w-0">
              <FieldGroup>{{ profile, date, display }[section]}</FieldGroup>
            </FieldSet>
            {controls(section)}
          </form>
          </CardContent>
        </Card>
      ))}
      <NavigationSettings inline onStateChange={setNavigationState} />
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
