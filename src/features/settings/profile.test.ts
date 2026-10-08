import { expect, test } from "vitest";
import { accountPreferences, nicknamePreference, preferenceMetadata, profileIconId, profileIcons, profileName } from "./account-preferences.ts";
test("고정 아이콘은 안정 ID만 허용하며 공급자 이미지와 알 수 없는 값은 기본으로 복원한다", () => {
  expect(new Set(profileIcons.map(icon => icon.id)).size).toBe(profileIcons.length);
  for (const icon of profileIcons) expect(profileIconId(icon.id)).toBe(icon.id);
  for (const value of [undefined, null, "https://example.com/avatar.png", "old-id", {}, 4]) expect(profileIconId(value)).toBe("person");
});
test("저장 계약은 변경한 개인 설정만 보내고 닉네임·기본값을 검증한다", () => {
  expect(preferenceMetadata({ nickname: "  별빛고양이  " })).toEqual({ workspace_nickname: "별빛고양이" });
  expect(preferenceMetadata({ nickname: "   " })).toEqual({ workspace_nickname: null });
  expect(preferenceMetadata({ icon: "cat", timezone: null })).toEqual({ workspace_avatar_id: "cat", workspace_timezone: null });
  for (const nickname of ["x".repeat(41), "이름\n두줄"]) expect(() => preferenceMetadata({ nickname })).toThrow("닉네임");
  expect(nicknamePreference({})).toBeNull();
  expect(accountPreferences({ workspace_avatar_id: "unknown", workspace_nickname: 7, workspace_timezone: "unknown" })).toEqual({ icon: "person", nickname: null, timezone: null });
  expect(profileName({ workspace_nickname: "닉네임", full_name: "계정 이름", email: "private@example.test" })).toBe("닉네임");
  expect(profileName({ full_name: " 계정 이름 " })).toBe("계정 이름");
  expect(profileName({ email: "private@example.test" })).toBe("내 계정");
});
