import { assertEquals } from "@std/assert";
import { entityId, entityNumberInput, entityReferenceId, splitEntityId } from "./entity-identity.ts";
Deno.test("Canonical references retain the complete raw number and lowercase UUID metadata", () => {
  const type = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const id = entityId("crm", type, "001A:B/한글_%");
  assertEquals(id, "crm:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:001A:B/한글_%");
  assertEquals(splitEntityId(id).external_id, "001A:B/한글_%");
  assertEquals(entityReferenceId.safeParse("crm:001A:B").success, false);
  assertEquals(entityNumberInput.safeParse(" 001 ").success, false);
  assertEquals(entityNumberInput.parse("001 A:B"), "001 A:B");
});
