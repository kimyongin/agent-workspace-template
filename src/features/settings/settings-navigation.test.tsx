import { expect, it } from "vitest";
import { settingsCategoryCurrent, workspaceSettingsDestinations } from "./SettingsNavigation.tsx";

it("자료 설정의 직접·구 경로에서도 정확한 현재 범주를 표시한다", () => {
  for (
    const path of [
      "/settings/materials",
      "/settings/entity-types/type-id/migrations",
      "/settings/relations",
      "/settings/issuers",
      "/settings/data-model",
    ]
  ) {
    expect(settingsCategoryCurrent(path, "/settings/materials")).toBe(true);
    expect(settingsCategoryCurrent(path, "/settings")).toBe(false);
  }
  expect(settingsCategoryCurrent("/settings/navigation", "/settings")).toBe(true);
  expect(settingsCategoryCurrent("/settings/tags", "/settings/materials")).toBe(false);
});

it("공간 없음과 관리 권한 없음에도 공간 목록은 유지한다", () => {
  expect(workspaceSettingsDestinations(null, true)).toEqual([{ to: "/workspaces", label: "공간 목록 · 새 공간" }]);
  expect(workspaceSettingsDestinations("space", false)).toEqual([{ to: "/workspaces", label: "공간 목록 · 새 공간" }]);
  expect(workspaceSettingsDestinations("space", true)).toHaveLength(2);
});
