import { assertEquals } from "@std/assert";
import { identityFixture } from "../../../../tests/_entity-identity.ts";
const defaultIdentity = identityFixture("00000000-0000-4000-8000-000000000001");
import { registrationContent, registrationIdentity, registrationState } from "./domain.ts";

Deno.test("엔터티 판단: 복원의 생략·명시 속성은 준비와 저장에 함께 쓰인다", () => {
  const identity = registrationIdentity(defaultIdentity, { external_id: "000Ab:/한글%" });
  const type = { entity_type_id: "00000000-0000-4000-8000-000000000001", schema_version: 1 };
  assertEquals(registrationContent({ ...type, properties: { prop_1: "새 대상" } }, identity), {
    ...type,
    source: "app",
    external_id: "000Ab:/한글%",
    properties: { prop_1: "새 대상" },
  });
  const stored = {
    ...type,
    source: "app",
    external_id: "000Ab:/한글%",
    properties: { prop_1: "보관값", prop_2: 0, prop_3: null, prop_4: "c" },
    tag_ids: ["보관 태그"],
  };
  assertEquals(registrationContent({ ...type, properties: { prop_3: "2026-10-10" } }, identity, stored), {
    ...type,
    ...identity,
    properties: { ...stored.properties, prop_3: "2026-10-10" },
  });
  assertEquals(
    registrationContent({ ...type, properties: { prop_2: null } }, identity, stored).properties.prop_2,
    null,
  );
});

Deno.test("엔터티 판단: 준비 스냅샷과 저장 조회는 부재·활성 중복·복원을 같은 상태로 분류", () => {
  assertEquals(registrationState(null), "create");
  assertEquals(registrationState({ deleted_at: null }), "duplicate");
  assertEquals(registrationState({ deleted_at: "2026-10-10T00:00:00Z" }), "restore");
});
