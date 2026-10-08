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
  return displayScales.find(scale => value === scale || value === String(scale)) ?? 100;
}
export interface AccountPreferences { icon: ProfileIconId; nickname: string | null; timezone: string | null; displayScale: DisplayScale }
export function profileIconId(value: unknown): ProfileIconId {
  return profileIcons.find(icon => icon.id === value)?.id ?? "person";
}
export function nicknamePreference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  return nickname && nickname.length <= 40 && !/[\u0000-\u001f\u007f]/.test(nickname) ? nickname : null;
}
export function profileName(metadata: Record<string, unknown> | undefined): string {
  return nicknamePreference(metadata?.workspace_nickname)
    ?? (typeof metadata?.full_name === "string" && metadata.full_name.trim() ? metadata.full_name.trim() : "내 계정");
}

const preferenceKeys = { icon: "workspace_avatar_id", nickname: "workspace_nickname", timezone: "workspace_timezone", displayScale: "workspace_display_scale" } as const;
/** 개인 표시 설정의 JSON 저장 계약. 권한·비밀값·업무 데이터는 포함하지 않는다. */
export function accountPreferences(metadata: Record<string, unknown>): AccountPreferences {
  return { icon: profileIconId(metadata[preferenceKeys.icon]), nickname: nicknamePreference(metadata[preferenceKeys.nickname]), timezone: timezonePreference(metadata[preferenceKeys.timezone]), displayScale: displayScalePreference(metadata[preferenceKeys.displayScale]) };
}
export function preferenceMetadata(changes: Partial<AccountPreferences>): Record<string, string | null> {
  const metadata: Record<string, string | null> = {};
  if (changes.icon !== undefined) {
    if (profileIconId(changes.icon) !== changes.icon) throw new Error("프로필 아이콘을 선택하세요.");
    metadata[preferenceKeys.icon] = changes.icon;
  }
  if (changes.nickname !== undefined) {
    const nickname = nicknamePreference(changes.nickname);
    if (changes.nickname !== null && changes.nickname.trim() && nickname === null) throw new Error("닉네임은 40자 이하의 한 줄 텍스트로 입력하세요.");
    metadata[preferenceKeys.nickname] = nickname;
  }
  if (changes.timezone !== undefined) {
    if (changes.timezone !== null && timezonePreference(changes.timezone) === null) throw new Error("올바른 시간대를 선택하세요.");
    metadata[preferenceKeys.timezone] = changes.timezone;
  }
  if (changes.displayScale !== undefined) {
    if (!displayScales.includes(changes.displayScale)) throw new Error("화면 배율을 선택하세요.");
    metadata[preferenceKeys.displayScale] = String(changes.displayScale);
  }
  return metadata;
}
