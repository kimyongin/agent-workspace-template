import { expect, test } from "vitest";
import { createSettingsDraft } from "./settings-draft.ts";
import { typeIdentitySettingsAdapter } from "./type-identity-settings.ts";
import type { EntityTypeIdentity } from "@contracts/entity-issuer.ts";
test("종류 식별자 이름 변경을 취소하면 저장된 발급처와 이름으로 돌아간다", async () => {
  const saved: EntityTypeIdentity = {
    type_id: "11111111-1111-4111-8111-111111111111",
    label: "상품 번호",
    default_source: "app",
    version: 3,
    sources: [{
      code: "app",
      rule_id: "00000000-0000-4000-8000-000000000001",
      active: true,
      referenced: false,
      source_label: "앱",
      rule_label: "자동 발급",
      generation: "automatic",
    }],
  };
  const resource = createSettingsDraft(
    typeIdentitySettingsAdapter(saved.type_id, {
      read: async () => saved,
      save: async () => {
        throw new Error("취소한 설정을 저장하면 안 됩니다");
      },
    }),
  );
  await resource.read();
  resource.edit((v) => ({ ...v, label: "주문 번호" }));
  resource.reset();
  expect(resource.snapshot()).toMatchObject({
    dirty: false,
    draft: {
      label: "상품 번호",
      default_source: "app",
      sources: [{ code: "app", rule_id: "00000000-0000-4000-8000-000000000001", active: true }],
    },
  });
});

import { ApiError } from "../../lib/api-error.ts";
test("식별자 설정 충돌 뒤 최신 버전을 명시적으로 채택해도 입력 초안은 유지한다", async () => {
  let saved: EntityTypeIdentity = {
    type_id: "11111111-1111-4111-8111-111111111111",
    label: "상품 번호",
    default_source: "app",
    version: 3,
    sources: [],
  };
  let fail = true;
  const resource = createSettingsDraft(typeIdentitySettingsAdapter(saved.type_id, {
    read: async () => saved,
    save: async (_id, input) => {
      if (fail) {
        saved = { ...saved, label: "외부 변경", version: 4 };
        fail = false;
        throw new ApiError(409, "settings_changed", "동시 변경");
      }
      saved = { ...saved, label: input.label, version: 5 };
      expect(input.expected_version).toBe(4);
      return saved;
    },
  }));
  await resource.read();
  resource.edit((v) => ({ ...v, label: "내 상품 번호" }));
  await resource.save();
  await resource.read();
  expect(resource.snapshot()).toMatchObject({
    conflict: true,
    draft: { label: "내 상품 번호" },
    saved: { label: "외부 변경", version: 4 },
  });
  resource.acceptLatest();
  await resource.save();
  expect(resource.snapshot()).toMatchObject({
    conflict: false,
    dirty: false,
    saved: { label: "내 상품 번호", version: 5 },
  });
});
