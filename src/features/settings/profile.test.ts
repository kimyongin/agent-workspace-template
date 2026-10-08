import { expect, test } from "vitest";
import { accountPreferences, displayScalePreference, displayScales, nicknamePreference, preferenceMetadata, profileIconId, profileIcons, profileName } from "./account-preferences.ts";
test("고정 아이콘은 안정 ID만 허용하며 공급자 이미지와 알 수 없는 값은 기본으로 복원한다", () => {
  expect(new Set(profileIcons.map(icon => icon.id)).size).toBe(profileIcons.length);
  for (const icon of profileIcons) expect(profileIconId(icon.id)).toBe(icon.id);
  for (const value of [undefined, null, "https://example.com/avatar.png", "old-id", {}, 4]) expect(profileIconId(value)).toBe("person");
});
test("화면 배율은 허용된 값만 저장하고 알 수 없는 metadata는 기본값으로 복원한다", () => {
  for (const scale of displayScales) {
    expect(preferenceMetadata({ displayScale: scale })).toEqual({ workspace_display_scale: String(scale) });
    expect(accountPreferences({ workspace_display_scale: String(scale) }).displayScale).toBe(scale);
  }
  for (const value of [null, {}, "125%", "200", 0, Infinity, "", " 125", "125.0"]) expect(displayScalePreference(value)).toBe(100);
  expect(() => preferenceMetadata({ displayScale: 200 as 100 })).toThrow("배율");
  expect(preferenceMetadata({ nickname: "이름" })).toEqual({ workspace_nickname: "이름" });
});
test("저장 계약은 변경한 개인 설정만 보내고 닉네임·기본값을 검증한다", () => {
  expect(preferenceMetadata({ nickname: "  별빛고양이  " })).toEqual({ workspace_nickname: "별빛고양이" });
  expect(preferenceMetadata({ nickname: "   " })).toEqual({ workspace_nickname: null });
  expect(preferenceMetadata({ icon: "cat", timezone: null })).toEqual({ workspace_avatar_id: "cat", workspace_timezone: null });
  for (const nickname of ["x".repeat(41), "이름\n두줄"]) expect(() => preferenceMetadata({ nickname })).toThrow("닉네임");
  expect(nicknamePreference({})).toBeNull();
  expect(accountPreferences({ workspace_avatar_id: "unknown", workspace_nickname: 7, workspace_timezone: "unknown" })).toEqual({ icon: "person", nickname: null, timezone: null, displayScale: 100 });
  expect(profileName({ workspace_nickname: "닉네임", full_name: "계정 이름", email: "private@example.test" })).toBe("닉네임");
  expect(profileName({ full_name: " 계정 이름 " })).toBe("계정 이름");
  expect(profileName({ email: "private@example.test" })).toBe("내 계정");
});
