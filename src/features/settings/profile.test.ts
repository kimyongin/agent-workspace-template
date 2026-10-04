import { expect, test } from "vitest";
import { profileIconId, profileIcons } from "./profile.tsx";
test("고정 아이콘은 안정 ID만 허용하며 공급자 이미지와 알 수 없는 값은 기본으로 복원한다", () => {
  expect(new Set(profileIcons.map(icon => icon.id)).size).toBe(profileIcons.length);
  for (const icon of profileIcons) expect(profileIconId(icon.id)).toBe(icon.id);
  for (const value of [undefined, null, "https://example.com/avatar.png", "old-id", {}, 4]) expect(profileIconId(value)).toBe("person");
});
