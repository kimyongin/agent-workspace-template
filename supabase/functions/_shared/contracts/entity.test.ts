import { assertEquals } from "@std/assert";
import { entityCreate, entityListQuery, entityUpdate } from "./entity.ts";
Deno.test("Entity 입력: 코드 포인트·숫자 0·날짜·선택·부분 수정과 서버 필드 거부", () => {
  assertEquals(entityCreate.parse({ prop1: "  예제  " }), { prop1: "예제", prop2: null, prop3: null, prop4: "a" });
  assertEquals(entityCreate.parse({ prop1: "😀".repeat(100), prop2: 0, prop3: "2024-02-29", prop4: "c" }).prop2, 0);
  for (
    const input of [
      { prop1: " " },
      { prop1: "😀".repeat(101) },
      { prop1: "예제", prop2: 1.1 },
      { prop1: "예제", prop2: 1_000_001 },
      { prop1: "예제", prop3: "2023-02-29" },
      { prop1: "예제", prop4: "d" },
      { prop1: "예제", owner_id: crypto.randomUUID() },
    ]
  ) assertEquals(entityCreate.safeParse(input).success, false);
  assertEquals(entityUpdate.safeParse({ change_note: "테스트 변경 이유", expected_version: 1 }).success, false);
  assertEquals(entityUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 1, prop2: null }), {
    change_note: "테스트 변경 이유",
    expected_version: 1,
    prop2: null,
  });
  assertEquals(entityListQuery.safeParse({ prop3_from: "2026-10-05", prop3_to: "2026-10-04" }).success, false);
});
