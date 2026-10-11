import { assertEquals, assertThrows } from "@std/assert";
import { defaultEntityIdentitySettings } from "../../contracts/entity-identity.ts";
import { AppError } from "../shared/errors.ts";
import { entityUpdateDecision, registrationContent, registrationIdentity, registrationState } from "./domain.ts";

Deno.test("엔터티 판단: 등록 기본값과 복원의 생략·명시 값은 준비와 저장에 함께 쓰인다", () => {
  const identity = registrationIdentity(defaultEntityIdentitySettings, { external_id: "000Ab:/한글%" });
  assertEquals(registrationContent({ prop1: "새 대상" }, identity), {
    source: "app",
    external_id: "000Ab:/한글%",
    prop1: "새 대상",
    prop2: null,
    prop3: null,
    prop4: "a",
    tag_ids: [],
  });
  const stored = {
    source: "app",
    external_id: "000Ab:/한글%",
    prop1: "보관값",
    prop2: 0,
    prop3: null,
    prop4: "c" as const,
    tag_ids: ["보관 태그"],
  };
  assertEquals(registrationContent({ prop3: "2026-10-10", tag_ids: [] }, identity, stored), {
    ...stored,
    prop3: "2026-10-10",
    tag_ids: [],
  });
  assertEquals(registrationContent({ prop2: null }, identity, stored).prop2, null);
});

Deno.test("엔터티 판단: 준비 스냅샷과 저장 조회는 부재·활성 중복·복원을 같은 상태로 분류", () => {
  assertEquals(registrationState(null), "create");
  assertEquals(registrationState({ deleted_at: null }), "duplicate");
  assertEquals(registrationState({ deleted_at: "2026-10-10T00:00:00Z" }), "restore");
});

Deno.test("엔터티 판단: 삭제된 발급처의 기존 속성 편집은 유지하지만 새 식별은 거부한다", () => {
  const settings = { ...defaultEntityIdentitySettings, sources: [{ code: "app", label: "앱", deleted: true }] };
  const current = { id: "app:001", facts: { source: "app", external_id: "001", prop1: "보관값", prop2: 0 } };
  assertEquals(entityUpdateDecision(settings, current, { prop1: "수정" }).after.prop1, "수정");
  assertEquals(entityUpdateDecision(settings, current, { external_id: "001" }).rekey, false);
  assertThrows(() => entityUpdateDecision(settings, current, { external_id: "002" }), AppError);
  assertThrows(() => entityUpdateDecision(settings, current, { external_id: "001" }, true), AppError);
  assertThrows(() => registrationIdentity(settings, { external_id: "001" }), AppError);
});

Deno.test("엔터티 판단: 같은 식별·태그 순서만 변경하면 업무 변경이 아니다", () => {
  const current = { id: "app:001", facts: { source: "app", external_id: "001", tag_ids: ["a", "b"] } };
  const result = entityUpdateDecision(defaultEntityIdentitySettings, current, {
    external_id: "001",
    tag_ids: ["b", "a"],
  });
  assertEquals([result.rekey, result.contentChanged], [false, false]);
});
