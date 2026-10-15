import type { NavigationRef } from "../../app/type-navigation.ts";
import { timezonePreference } from "../../lib/timezone.ts";

export const profileIcons = [
  { id: "person", label: "기본", emoji: "😊" },
  { id: "cool", label: "선글라스", emoji: "😎" },
  { id: "nerd", label: "안경", emoji: "🤓" },
  { id: "party", label: "축하", emoji: "🥳" },
  { id: "cat", label: "고양이", emoji: "🐱" },
  { id: "dog", label: "강아지", emoji: "🐶" },
  { id: "fox", label: "여우", emoji: "🦊" },
  { id: "panda", label: "판다", emoji: "🐼" },
  { id: "bear", label: "곰", emoji: "🐻" },
  { id: "rabbit", label: "토끼", emoji: "🐰" },
  { id: "lion", label: "사자", emoji: "🦁" },
  { id: "tiger", label: "호랑이", emoji: "🐯" },
  { id: "frog", label: "개구리", emoji: "🐸" },
  { id: "penguin", label: "펭귄", emoji: "🐧" },
  { id: "leaf", label: "잎", emoji: "🌱" },
  { id: "sun", label: "해바라기", emoji: "🌻" },
  { id: "star", label: "별", emoji: "⭐" },
  { id: "moon", label: "달", emoji: "🌙" },
  { id: "rocket", label: "로켓", emoji: "🚀" },
  { id: "target", label: "과녁", emoji: "🎯" },
] as const;
export type ProfileIconId = typeof profileIcons[number]["id"];
export const displayScales = [100, 110, 125, 150] as const;
export type DisplayScale = typeof displayScales[number];
export function displayScalePreference(value: unknown): DisplayScale {
  return displayScales.find((scale) => value === scale || value === String(scale)) ?? 100;
}
export interface NavigationPreference {
  version: 1;
  refs: NavigationRef[];
}
export type PreferenceMetadata = Record<string, string | null | NavigationPreference>;
export function navigationPreference(value: unknown): NavigationPreference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { version?: unknown; refs?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.refs) || candidate.refs.length > 4) return null;
  const refs: NavigationRef[] = [];
  const seen = new Set<string>();
  for (const ref of candidate.refs) {
    if (!ref || typeof ref !== "object" || typeof ref.id !== "string") return null;
    if (
      ref.kind === "builtin"
        ? !["entities", "tasks", "records"].includes(ref.id)
        : ref.kind !== "type" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.id)
    ) return null;
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    refs.push({ kind: ref.kind, id: ref.id } as NavigationRef);
  }
  return { version: 1, refs };
}
export interface AccountPreferences {
  navigation: NavigationPreference | null;
  icon: ProfileIconId;
  nickname: string | null;
  timezone: string | null;
  desktopDisplayScale: DisplayScale;
  mobileDisplayScale: DisplayScale;
}
export function profileIconId(value: unknown): ProfileIconId {
  return profileIcons.find((icon) => icon.id === value)?.id ?? "person";
}
export function nicknamePreference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  return nickname && nickname.length <= 40 && !/[\u0000-\u001f\u007f]/.test(nickname) ? nickname : null;
}
export function profileName(metadata: Record<string, unknown> | undefined): string {
  return nicknamePreference(metadata?.workspace_nickname) ??
    (typeof metadata?.full_name === "string" && metadata.full_name.trim() ? metadata.full_name.trim() : "내 계정");
}

const preferenceKeys = {
  navigation: "workspace_navigation",
  icon: "workspace_avatar_id",
  nickname: "workspace_nickname",
  timezone: "workspace_timezone",
  desktopDisplayScale: "workspace_display_scale",
  mobileDisplayScale: "workspace_mobile_display_scale",
} as const;
/** 개인 표시 설정의 JSON 저장 계약. 권한·비밀값·업무 데이터는 포함하지 않는다. */
export function accountPreferences(metadata: Record<string, unknown>): AccountPreferences {
  return {
    navigation: navigationPreference(metadata[preferenceKeys.navigation]),
    icon: profileIconId(metadata[preferenceKeys.icon]),
    nickname: nicknamePreference(metadata[preferenceKeys.nickname]),
    timezone: timezonePreference(metadata[preferenceKeys.timezone]),
    desktopDisplayScale: displayScalePreference(metadata[preferenceKeys.desktopDisplayScale]),
    mobileDisplayScale: displayScalePreference(metadata[preferenceKeys.mobileDisplayScale]),
  };
}
export function preferenceMetadata(changes: Partial<AccountPreferences>): PreferenceMetadata {
  const metadata: PreferenceMetadata = {};
  if (changes.navigation !== undefined) {
    const navigation = navigationPreference(changes.navigation);
    if (changes.navigation !== null && !navigation) throw new Error("바로가기는 중복 없이 최대 4개를 선택하세요.");
    metadata[preferenceKeys.navigation] = navigation;
  }
  if (changes.icon !== undefined) {
    if (profileIconId(changes.icon) !== changes.icon) throw new Error("프로필 아이콘을 선택하세요.");
    metadata[preferenceKeys.icon] = changes.icon;
  }
  if (changes.nickname !== undefined) {
    const nickname = nicknamePreference(changes.nickname);
    if (changes.nickname !== null && changes.nickname.trim() && nickname === null) {
      throw new Error("닉네임은 40자 이하의 한 줄 텍스트로 입력하세요.");
    }
    metadata[preferenceKeys.nickname] = nickname;
  }
  if (changes.timezone !== undefined) {
    if (changes.timezone !== null && timezonePreference(changes.timezone) === null) {
      throw new Error("올바른 시간대를 선택하세요.");
    }
    metadata[preferenceKeys.timezone] = changes.timezone;
  }
  for (const field of ["desktopDisplayScale", "mobileDisplayScale"] as const) {
    const scale = changes[field];
    if (scale !== undefined) {
      if (!displayScales.includes(scale)) throw new Error("화면 배율을 선택하세요.");
      metadata[preferenceKeys[field]] = String(scale);
    }
  }
  return metadata;
}
